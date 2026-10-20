import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { applyArchiveManifest, verifyFrozenArchiveSource } from "../src/server/kp/archive/apply";
import { ArchiveImportError, type ArchiveSource } from "../src/server/kp/archive/contract";
import { allArchiveObjects, prepareArchiveManifest } from "../src/server/kp/archive/manifest";
import { createReadonlyArchiveSource, type SourceConfiguration } from "../src/server/kp/archive/source";
import { archiveFixture } from "./helpers/kp-archive-fixture";

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const turns = async (count = 12) => { for (let i = 0; i < count; i++) await new Promise<void>(done => setImmediate(done)); };
const changed = (error: unknown) => error instanceof ArchiveImportError && error.code === "ARCHIVE_SOURCE_CHANGED";
const close = async (source: ArchiveSource) => { assert.ok("close" in source && typeof source.close === "function"); await source.close(); };

test("readonly source reuses clients, drains close and keeps immutable binding/credential checks without network", async t => {
  const f = archiveFixture(), configuration: SourceConfiguration = { profile: structuredClone(f.sourceProfile), credentials: { public: { accessKeyId: "synthetic-public", secretAccessKey: "synthetic-secret" }, contracts: { accessKeyId: "synthetic-private", secretAccessKey: "synthetic-secret" } } };
  const instances = new Set<S3Client>(), destroyed = new Set<S3Client>(), gate = deferred(); let held = false, bodyCloses = 0;
  t.mock.method(S3Client.prototype, "send", async function (this: S3Client, command: GetObjectCommand | ListObjectsV2Command, options: { abortSignal: AbortSignal }) {
    instances.add(this); assert.ok(options.abortSignal instanceof AbortSignal); assert.equal(await this.config.maxAttempts(), 1);
    if (command instanceof ListObjectsV2Command) return { Contents: [], IsTruncated: false };
    assert.ok(command instanceof GetObjectCommand); if (held) await gate.promise;
    const body = Readable.from([Buffer.from("bytes")]); body.on("close", () => bodyCloses++);
    return { Body: body, ContentLength: 5, ContentType: "image/jpeg", LastModified: new Date("2023-01-01T00:00:00Z") };
  });
  t.mock.method(S3Client.prototype, "destroy", function (this: S3Client) { assert.equal(destroyed.has(this), false); destroyed.add(this); });
  const source = createReadonlyArchiveSource(f.sourceProfile, () => configuration);
  try {
    await source.read("public", "kp/one.jpg", 5); await source.read("public", "kp/two.jpg", 5);
    assert.equal(instances.size, 1, "two reads must share the SDK connection pool"); assert.equal(destroyed.size, 0);
    await source.list("contracts", "exports/"); assert.equal(instances.size, 2);
    configuration.profile.public.bucket = "foreign"; await assert.rejects(source.read("public", "kp/three.jpg", 5)); assert.equal(instances.size, 2); configuration.profile.public.bucket = f.sourceProfile.public.bucket;
    configuration.credentials.public.secretAccessKey = "rotated-synthetic-secret"; await source.read("public", "kp/three.jpg", 5); assert.equal(instances.size, 3); assert.equal(destroyed.size, 1);
    held = true; const pending = source.read("public", "kp/four.jpg", 5); await turns(1); let closed = false;
    const closing = close(source).then(() => { closed = true; }); await turns(1); assert.equal(closed, false, "close must drain an already started read");
    gate.resolve(); await pending; await closing; assert.equal(destroyed.size, 3); assert.equal(bodyCloses, 4);
    await assert.rejects(source.read("public", "kp/after-close.jpg", 5)); assert.equal(instances.size, 3);
  } finally { gate.resolve(); if ("close" in source && typeof source.close === "function") await source.close(); }
});

test("actual SDK serialization reuses each area client and explicitly closes memory HTTP handles and response bodies", async () => {
  const f = archiveFixture(), configuration: SourceConfiguration = { profile: f.sourceProfile, credentials: { public: { accessKeyId: "SYNTHETIC_PUBLIC", secretAccessKey: "synthetic-public-secret" }, contracts: { accessKeyId: "SYNTHETIC_PRIVATE", secretAccessKey: "synthetic-private-secret" } } };
  const handles: { calls: number; destroyed: boolean }[] = [], bodies: Readable[] = [];
  const source = createReadonlyArchiveSource(f.sourceProfile, () => configuration, options => {
    const handle = { calls: 0, destroyed: false }; handles.push(handle);
    return new S3Client({ ...options, requestHandler: {
      async handle(request: { method: string; path: string; headers: Record<string, string> }, options?: { abortSignal?: unknown }) {
        assert.equal(handle.destroyed, false); assert.equal(request.method, "GET"); assert.ok(request.path.startsWith("/kp/") || request.path.startsWith("/exports/"));
        assert.equal(typeof request.headers.authorization, "string"); assert.ok(options?.abortSignal instanceof AbortSignal); handle.calls++;
        const body = Readable.from([Buffer.from("bytes")]); bodies.push(body);
        return { response: { statusCode: 200, headers: { "content-length": "5", "content-type": "image/jpeg", "last-modified": "Sun, 01 Jan 2023 00:00:00 GMT" }, body } };
      },
      destroy() { assert.equal(handle.destroyed, false); handle.destroyed = true; },
    } });
  });
  try {
    for (const key of ["kp/one.jpg", "kp/two.jpg", "kp/three.jpg"]) assert.equal((await source.read("public", key, 5)).bytes.toString(), "bytes");
    await source.read("contracts", "exports/one.docx", 5);
    assert.equal(handles.length, 2); assert.deepEqual(handles.map(h => h.calls), [3, 1]); assert.ok(handles.every(h => !h.destroyed)); assert.ok(bodies.every(body => body.destroyed));
  } finally { await source.close(); }
  assert.ok(handles.every(h => h.destroyed));
});

test("full source verification admits four bounded reads but never overlapping database authorization", async t => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links), original = f.source.read, gate = deferred();
  let active = 0, peak = 0, calls = 0, auth = 0, authPeak = 0, authorizations = 0;
  const expected = new Map([...manifest.proposals.map(p => p.sourceObject), ...manifest.settings.map(s => s.sourceObject), ...allArchiveObjects(manifest).map(o => o.source)].map(o => [o.area + ":" + o.key, o.size]));
  f.source.read = async (area, key, limit) => { active++; peak = Math.max(peak, active); const ordinal = ++calls;
    try { assert.equal(limit, expected.get(area + ":" + key)); if (ordinal <= 4) await gate.promise; return await original(area, key, limit); } finally { active--; } };
  const pending = verifyFrozenArchiveSource(manifest, f.source, async () => { auth++; authorizations++; authPeak = Math.max(authPeak, auth); try { await turns(1); } finally { auth--; } });
  try { await turns(20); assert.equal(active, 4); assert.equal(peak, 4); assert.equal(authPeak, 1); }
  finally { gate.resolve(); await pending; }
  assert.equal(active, 0); assert.equal(calls, expected.size); assert.equal(authPeak, 1);
  assert.equal(authorizations, 2 + 2 * expected.size); t.diagnostic(JSON.stringify({ synthetic: true, sourceReads: calls, peakReaders: peak, peakConcurrentAuthorization: authPeak, authorizations }));
});

test("weighted admission cannot schedule two80MiB DOCX at once and rejects untrusted oversize before source IO", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links), objects = allArchiveObjects(manifest).filter(o => o.role === "docx"), large = new Set(objects.slice(0, 2).map(o => o.source.key));
  for (const docx of manifest.docx) if (large.has(docx.sourceObject.key)) { docx.sourceObject.size = 80 * 1024 * 1024; docx.artifact!.source.size = docx.sourceObject.size; }
  const original = f.source.read, gate = deferred(), started = deferred(), failure = Error("synthetic-budget-stop"); let activeBytes = 0, peak = 0, largeCalls = 0;
  f.source.read = async (area, key, limit) => { activeBytes += limit; peak = Math.max(peak, activeBytes);
    try { if (large.has(key)) { largeCalls++; assert.equal(limit, 80 * 1024 * 1024); started.resolve(); await gate.promise; throw failure; } return await original(area, key, limit); } finally { activeBytes -= limit; } };
  const pending = verifyFrozenArchiveSource(manifest, f.source); const outcome = assert.rejects(pending, error => error === failure);
  try { await started.promise; await turns(2); assert.equal(largeCalls, 1); assert.ok(peak <= 128 * 1024 * 1024); }
  finally { gate.resolve(); await outcome; }
  assert.equal(activeBytes, 0); assert.equal(largeCalls, 1);
  const invalid = archiveFixture(), bad = await prepareArchiveManifest(invalid.source, invalid.target, invalid.deps, invalid.links), reads = invalid.counters.sourceReads;
  bad.proposals[0].sourceObject.size = 512 * 1024 + 1; await assert.rejects(verifyFrozenArchiveSource(bad, invalid.source)); assert.equal(invalid.counters.sourceReads, reads);
});

test("first reader failure latches, drains the other three and never reserves or starts later source reads", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links), original = f.source.read, fail = deferred(), drain = deferred(), error = Error("synthetic-first-read-failure");
  let calls = 0, active = 0, settled = false;
  f.source.read = async (...args) => { const index = ++calls; active++; try { if (index === 1) { await fail.promise; throw error; } await drain.promise; return await original(...args); } finally { active--; } };
  const pending = applyArchiveManifest(manifest, f.options(manifest)); const outcome = assert.rejects(pending, value => value === error).finally(() => { settled = true; });
  try { await turns(); assert.equal(active, 4); fail.resolve(); await turns(2); assert.equal(settled, false); assert.equal(calls, 4); }
  finally { fail.resolve(); drain.resolve(); await outcome; }
  assert.equal(active, 0); assert.equal(f.counters.reserves, 0); assert.equal(f.counters.puts, 0);
});

test("authorization failure stops admission, drains the started read and preserves the original failure", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links), read = f.source.read, gate = deferred(), failure = Error("synthetic-actor-expired");
  let auth = 0, reads = 0, settled = false;
  f.source.read = async (...args) => { reads++; await gate.promise; return read(...args); };
  const pending = verifyFrozenArchiveSource(manifest, f.source, async () => { if (++auth === 4) throw failure; });
  const outcome = assert.rejects(pending, error => error === failure).finally(() => { settled = true; });
  try { await turns(); assert.equal(reads, 1); assert.equal(settled, false); assert.equal(auth, 4); }
  finally { gate.resolve(); await outcome; }
  assert.equal(reads, 1); assert.equal(auth, 4);
});

test("conflicting duplicate source identity is rejected before any source GET", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links), reads = f.counters.sourceReads;
  manifest.proposals[1].sourceObject = { ...manifest.proposals[0].sourceObject, sha256: "f".repeat(64) };
  await assert.rejects(verifyFrozenArchiveSource(manifest, f.source), changed); assert.equal(f.counters.sourceReads, reads);
});

test("oversized headers and streaming bytes destroy bodies and keep the source explicitly closable", async t => {
  const f = archiveFixture(), config: SourceConfiguration = { profile: f.sourceProfile, credentials: { public: { accessKeyId: "synthetic", secretAccessKey: "synthetic" }, contracts: { accessKeyId: "synthetic", secretAccessKey: "synthetic" } } };
  const bodies: Readable[] = []; let header = true, destroys = 0;
  t.mock.method(S3Client.prototype, "send", async () => { const body = Readable.from([Buffer.from("sixsix")]); bodies.push(body); return { Body: body, ContentLength: header ? 6 : undefined }; });
  t.mock.method(S3Client.prototype, "destroy", () => { destroys++; });
  const source = createReadonlyArchiveSource(f.sourceProfile, () => config);
  try {
    await assert.rejects(source.read("public", "kp/one.jpg", 5)); assert.equal(bodies[0].destroyed, true);
    header = false; await assert.rejects(source.read("public", "kp/two.jpg", 5)); assert.equal(bodies[1].destroyed, true);
  } finally { await close(source); }
  assert.equal(destroys, 1);
});

test("verified targets omit only redundant per-object R2 reads while two full source passes and every target digest remain", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links), objects = allArchiveObjects(manifest), reserve = f.store.reserve;
  for (const object of objects) { f.blobs.set(object.key, Buffer.from(f.cloud.get(object.source.area + ":" + object.source.key)!.bytes)); f.state.verified.set(object.id, object.sha256); }
  f.store.reserve = async (m, owner) => ({ ...await reserve(m, owner), verifiedObjectIds: objects.map(o => o.id) });
  f.io.ensure = async () => { throw Error("verified-target-must-not-Put"); };
  const before = f.counters.sourceReads, unique = new Set([...manifest.proposals.map(p => p.sourceObject), ...manifest.settings.map(s => s.sourceObject), ...objects.map(o => o.source)].map(o => o.area + ":" + o.key)).size;
  const result = await applyArchiveManifest(manifest, f.options(manifest)); assert.equal(result.mode, "applied");
  assert.equal(f.counters.sourceReads - before, 2 * unique); assert.equal(f.counters.reads, objects.length); assert.equal(f.counters.puts, 0); assert.equal(f.counters.publishes, 1);
});

test("same-size source drift in the final parallel pass and stale verified target bytes still block publication", async () => {
  for (const targetChanged of [false, true]) {
    const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links), objects = allArchiveObjects(manifest), reserve = f.store.reserve, verify = f.io.verify;
    for (const object of objects) { f.blobs.set(object.key, Buffer.from(f.cloud.get(object.source.area + ":" + object.source.key)!.bytes)); f.state.verified.set(object.id, object.sha256); }
    f.store.reserve = async (m, owner) => ({ ...await reserve(m, owner), verifiedObjectIds: objects.map(o => o.id) });
    if (targetChanged) f.blobs.get(objects[0].key)![0] ^= 1;
    else f.io.verify = async (object, authorize) => { await verify(object, authorize); if (object.id === objects.at(-1)!.id) f.cloud.get("public:kp/photo-0.jpg")!.bytes[0] ^= 1; };
    await assert.rejects(applyArchiveManifest(manifest, f.options(manifest)), targetChanged ? error => error instanceof ArchiveImportError && error.code === "ARCHIVE_READBACK_MISMATCH" : changed);
    assert.equal(f.counters.puts, 0); assert.equal(f.counters.publishes, 0); assert.equal(f.state.visible.size, 0);
  }
});
