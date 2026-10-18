import assert from "node:assert/strict";
import { mkdtemp, readFile, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { applyArchiveManifest } from "../src/server/kp/archive/apply";
import { ArchiveImportError, byteHash, canonical, jsonClone, valueHash } from "../src/server/kp/archive/contract";
import { allArchiveObjects, archiveReport, prepareArchiveManifest, validateArchiveManifest } from "../src/server/kp/archive/manifest";
import { archiveProposalProvenance, archiveProposalVersionSnapshot } from "../src/server/kp/archive/provenance";
import { parseArchiveRecoveryMap, type ArchiveRecoveryMap } from "../src/server/kp/archive/recovery-contract";
import { createRecoveryArchiveSource } from "../src/server/kp/archive/recovery-source";
import { isArchiveObjectNotFound, normalizeArchiveSourceReadError } from "../src/server/kp/archive/source";
import { archiveFixture } from "./helpers/kp-archive-fixture";

const isCode = (...codes: string[]) => (error: unknown) => error instanceof ArchiveImportError && codes.includes(error.code);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
function missingError(name: string, status: number) { const error = new Error("synthetic source error"); error.name = name; return Object.assign(error, { $metadata: { httpStatusCode: status } }); }

async function recoveryFixture(t: TestContext, kind: "LOCAL_FILE" | "PDF_DCT" = "PDF_DCT") {
  const f = archiveFixture(), root = await mkdtemp(join(tmpdir(), "pero-kp-archive-recovery-")), hash = byteHash(jpg), key = "kp/photo-0.jpg", file = join(root, hash + ".jpg");
  const cleanup: (() => Promise<void>)[] = [];
  assert.equal(dirname(root), resolve(tmpdir()));
  await writeFile(file, jpg, { flag: "wx" });
  t.after(async () => { for (const remove of cleanup.reverse()) await remove(); assert.equal(dirname(file), root); await unlink(file); await rmdir(root); });
  f.cloud.delete("public:" + key);
  const map: ArchiveRecoveryMap = { schema: 1, sourceProfile: jsonClone(f.sourceProfile), sourceNamespace: valueHash(f.sourceProfile), reviewed: true, entries: [{ key, file: hash + ".jpg", sha256: hash, size: jpg.length, mimeType: "image/jpeg",
    references: Array.from({ length: 8 }, (_, index) => ({ documentId: f.ids[0], position: index + 1, slot: "image" })),
    origin: kind === "PDF_DCT" ? { kind, sourceFileSha256: byteHash("synthetic source PDF"), page: 2, object: 38, imageResource: "X38" } : { kind, sourceFileSha256: hash }, evidenceSha256: byteHash("synthetic reviewed correspondence"), reviewed: true }] };
  const source = createRecoveryArchiveSource(f.source, map, root);
  return { ...f, root, file, key, map, source, cloudSource: f.source, cleanup };
}
const prepare = (f: Awaited<ReturnType<typeof recoveryFixture>>) => prepareArchiveManifest(f.source, f.target, f.deps, f.links);

test("object-missing classification requires exact AWS name AND HTTP404", () => {
  assert.equal(isArchiveObjectNotFound(missingError("NoSuchKey", 404)), true);
  assert.equal(isArchiveObjectNotFound(missingError("NotFound", 404)), true);
  for (const name of ["NoSuchKey", "NotFound"]) assert.equal(isCode("ARCHIVE_SOURCE_MISSING")(normalizeArchiveSourceReadError(missingError(name, 404))), true);
  for (const [name, status] of [["NoSuchBucket", 404], ["AccessDenied", 404], ["UnknownError", 404], ["NoSuchKey", 403], ["NotFound", 500], ["TimeoutError", 408]] as const) {
    const error = missingError(name, status); assert.equal(isArchiveObjectNotFound(error), false); assert.equal(normalizeArchiveSourceReadError(error), error);
  }
  assert.equal(isArchiveObjectNotFound({ name: "NoSuchKey", $metadata: { httpStatusCode: 404 } }), false);
});

test("confirmed missing image is portable, explicit provenance survives JSON IMPORT snapshot and idempotent replay", async t => {
  const f = await recoveryFixture(t), read = f.cloudSource.read;
  f.cloudSource.read = async (area, key, limit) => { if (key === f.key) throw normalizeArchiveSourceReadError(missingError("NoSuchKey", 404)); return read(area, key, limit); };
  const manifest = await prepare(f), proposal = manifest.proposals.find(row => row.legacyId === f.ids[0])!, media = proposal.media[0];
  assert.deepEqual(manifest.counts, { proposals: 23, items: 189, settings: 6, docx: 7 });
  assert.equal(manifest.inventory.length, 36); assert.equal(manifest.recovery?.entries.length, 1);
  assert.equal(media.original, null); assert.equal(media.optimized.source.modifiedAt, null);
  assert.equal(media.optimized.source.recovery?.cloudState, "OBJECT_NOT_FOUND");
  assert.equal(media.optimized.source.recovery?.entry.origin.kind, "PDF_DCT");
  assert.equal(media.optimized.source.recovery?.entry.origin.sourceFileSha256, f.map.entries[0].origin.sourceFileSha256);
  assert.equal(media.optimized.source.recovery?.entry.evidenceSha256, f.map.entries[0].evidenceSha256);
  assert.equal(Buffer.from(proposal.rawBase64, "base64").includes(Buffer.from(f.sourceProfile.publicBaseUrl + "/" + f.key)), true);
  const decoded = JSON.parse(JSON.stringify(manifest)) as unknown, restored = validateArchiveManifest(decoded, f.deps);
  assert.equal(JSON.stringify(restored).includes(f.root), false);
  const options = { ...f.options(restored), source: f.source }, result = await applyArchiveManifest(restored, options);
  assert.equal(result.mode, "applied"); assert.equal(f.counters.publishes, 1);
  assert.deepEqual(f.blobs.get(media.optimized.key), jpg);
  assert.deepEqual(f.state.documentProvenance.get(proposal.id), archiveProposalProvenance(restored, proposal));
  const snapshot = archiveProposalVersionSnapshot(restored, proposal);
  assert.equal(snapshot.sourceStateOnly, true); assert.equal(snapshot.issuedPdfAvailable, false);
  assert.deepEqual(f.state.versionSnapshots.get(proposal.versionId), snapshot);
  assert.equal(snapshot.recovery?.objects[0].provenance.mapSha256, valueHash(manifest.recovery));
  assert.deepEqual(snapshot.recovery?.sourceProfile, f.sourceProfile);
  const puts = f.counters.puts;
  const replay = await applyArchiveManifest(restored, options);
  assert.equal("replayed" in replay && replay.replayed, true); assert.equal(f.counters.puts, puts); assert.equal(f.counters.publishes, 1);
  assert.equal(valueHash(f.state.business), f.originalBusinessHash); assert.equal(f.counters.sourceWrites, 0);
  assert.equal(archiveReport(restored).recovery?.originalR2BytesKnown, false);
});

test("other read errors cannot invoke local recovery even with a matching reviewed key", async t => {
  const f = await recoveryFixture(t), read = f.cloudSource.read;
  for (const error of [missingError("AccessDenied", 404), missingError("NoSuchBucket", 404), missingError("UnknownError", 404), missingError("NoSuchKey", 403), new Error("network unavailable")]) {
    f.cloudSource.read = async (area, key, limit) => { if (key === f.key) throw normalizeArchiveSourceReadError(error); return read(area, key, limit); };
    await assert.rejects(f.source.read("public", f.key, 100), actual => actual === error);
  }
  assert.equal(f.counters.reserves, 0);
});

test("unlisted missing keys remain missing and existing cloud keys never use local copies", async t => {
  const f = await recoveryFixture(t);
  await assert.rejects(f.source.read("public", "kp/unreviewed.jpg", 100), isCode("ARCHIVE_SOURCE_MISSING"));
  const actual = await f.source.read("public", "kp/photo-1.jpg", 100);
  assert.equal(actual.recovery, undefined); assert.deepEqual(actual.bytes, f.cloud.get("public:kp/photo-1.jpg")!.bytes);
});

test("any reappeared recovery source, even identical bytes, blocks prepare and apply before reserve", async t => {
  const f = await recoveryFixture(t), manifest = await prepare(f);
  f.set("public", f.key, jpg, "image/jpeg");
  await assert.rejects(prepare(f), isCode("ARCHIVE_RECOVERY_SOURCE_REAPPEARED"));
  await assert.rejects(applyArchiveManifest(manifest, { ...f.options(manifest), source: f.source }), isCode("ARCHIVE_RECOVERY_SOURCE_REAPPEARED"));
  assert.equal(f.counters.reserves, 0); assert.equal(f.counters.puts, 0);
});

test("reappearing R2 bytes after readback stop final publication", async t => {
  const f = await recoveryFixture(t), manifest = await prepare(f), ensure = f.io.ensure;
  f.io.ensure = async (object, bytes, authorize) => {
    const result = await ensure(object, bytes, authorize);
    if (object.source.key === f.key) f.set("public", f.key, jpg, "image/jpeg"); return result;
  };
  await assert.rejects(applyArchiveManifest(manifest, { ...f.options(manifest), source: f.source }), isCode("ARCHIVE_RECOVERY_SOURCE_REAPPEARED"));
  assert.equal(f.counters.publishes, 0); assert.equal(f.state.visible.size, 0); assert.equal(f.state.jobsState, "FAILED");
});

test("same-size local mutation after readback is re-read and blocks final publication", async t => {
  const f = await recoveryFixture(t), manifest = await prepare(f), ensure = f.io.ensure;
  f.io.ensure = async (object, bytes, authorize) => {
    const result = await ensure(object, bytes, authorize);
    if (object.source.key === f.key) { const changed = Buffer.from(jpg); changed[changed.length - 1] ^= 1; await writeFile(f.file, changed); } return result;
  };
  await assert.rejects(applyArchiveManifest(manifest, { ...f.options(manifest), source: f.source }), isCode("ARCHIVE_RECOVERY_BYTES_MISMATCH"));
  assert.equal(f.counters.publishes, 0); assert.equal(f.state.visible.size, 0); assert.equal(valueHash(f.state.business), f.originalBusinessHash);
});

test("local replacement size, SHA, MIME and declared read bound are verified each time", async t => {
  const f = await recoveryFixture(t);
  await assert.rejects(f.source.read("public", f.key, jpg.length - 1), isCode("ARCHIVE_SOURCE_SIZE_INVALID"));
  await writeFile(f.file, Buffer.concat([jpg, Buffer.from([0])]));
  await assert.rejects(f.source.read("public", f.key, 100), isCode("ARCHIVE_RECOVERY_BYTES_MISMATCH"));
  const changed = Buffer.from(jpg); changed[changed.length - 1] ^= 1; await writeFile(f.file, changed);
  await assert.rejects(f.source.read("public", f.key, 100), isCode("ARCHIVE_RECOVERY_BYTES_MISMATCH"));
  await writeFile(f.file, jpg);
  const map = jsonClone(f.map); map.entries[0].mimeType = "image/png"; map.entries[0].file = map.entries[0].sha256 + ".png";
  const png = join(f.root, map.entries[0].file); await writeFile(png, jpg); f.cleanup.push(() => unlink(png));
  await assert.rejects(createRecoveryArchiveSource(f.cloudSource, map, f.root).read("public", f.key, 100), isCode("ARCHIVE_RECOVERY_MIME_MISMATCH"));
});

test("unreviewed candidate map and unsafe paths cannot authorize replacement", async t => {
  const f = await recoveryFixture(t);
  const unreviewed = { ...f.map, reviewed: false, sourceProfile: null, sourceNamespace: null };
  assert.throws(() => parseArchiveRecoveryMap(unreviewed, f.sourceProfile), isCode("ARCHIVE_RECOVERY_REVIEW_REQUIRED"));
  const unreviewedEntry = jsonClone(f.map); Object.assign(unreviewedEntry.entries[0], { reviewed: false });
  assert.throws(() => parseArchiveRecoveryMap(unreviewedEntry, f.sourceProfile), isCode("ARCHIVE_RECOVERY_REVIEW_REQUIRED"));
  for (const file of ["../" + f.map.entries[0].file, f.file, "C:/outside/image.jpg", "folder/image.jpg", "..\\image.jpg"]) {
    const invalid = jsonClone(f.map); invalid.entries[0].file = file;
    assert.throws(() => createRecoveryArchiveSource(f.cloudSource, invalid, f.root), isCode("ARCHIVE_RECOVERY_MAP_INVALID"));
  }
  const foreign = jsonClone(f.map); foreign.sourceProfile.public.bucket = "different-source"; foreign.sourceNamespace = valueHash(foreign.sourceProfile);
  assert.throws(() => createRecoveryArchiveSource(f.cloudSource, foreign, f.root), isCode("ARCHIVE_RECOVERY_BINDING_MISMATCH"));
});

test("exact source references, origin and evidence are mandatory and manifest tampering fails", async t => {
  const f = await recoveryFixture(t), manifest = await prepare(f);
  for (const field of ["evidenceSha256", "origin"] as const) {
    const map = jsonClone(f.map); delete (map.entries[0] as Partial<typeof map.entries[0]>)[field];
    assert.throws(() => parseArchiveRecoveryMap(map, f.sourceProfile), isCode("ARCHIVE_RECOVERY_MAP_INVALID"));
  }
  const wrong = jsonClone(f.map); wrong.entries[0].references.pop();
  await assert.rejects(prepareArchiveManifest(createRecoveryArchiveSource(f.cloudSource, wrong, f.root), f.target, f.deps, f.links), isCode("ARCHIVE_RECOVERY_REFERENCE_MISMATCH"));
  const edited = jsonClone(manifest); edited.proposals.find(row => row.legacyId === f.ids[0])!.media[0].optimized.source.recovery!.entry.evidenceSha256 = "f".repeat(64);
  const data: Partial<typeof edited> = { ...edited }; delete data.sha256; edited.sha256 = valueHash(data);
  assert.throws(() => validateArchiveManifest(edited, f.deps), isCode("ARCHIVE_RECOVERY_PROVENANCE_MISMATCH"));
  await assert.rejects(applyArchiveManifest(manifest, { ...f.options(manifest), source: f.cloudSource }), isCode("ARCHIVE_RECOVERY_MAP_MISMATCH"));
  assert.equal(f.counters.reserves, 0);
});

test("portable asset root can change without altering provenance or manifest", async t => {
  const f = await recoveryFixture(t, "LOCAL_FILE"), manifest = await prepare(f), other = await mkdtemp(join(tmpdir(), "pero-kp-archive-recovery-")), file = join(other, f.map.entries[0].file);
  await writeFile(file, await readFile(f.file)); t.after(async () => { await unlink(file); await rmdir(other); });
  const source = createRecoveryArchiveSource(f.cloudSource, f.map, other), moved = await prepareArchiveManifest(source, f.target, f.deps, f.links);
  assert.equal(moved.sha256, manifest.sha256); assert.equal(canonical(moved.recovery), canonical(manifest.recovery));
  assert.equal(moved.recovery?.entries[0].origin.kind, "LOCAL_FILE");
  await applyArchiveManifest(moved, { ...f.options(moved), source });
});

test("a junction/symlink root cannot escape the declared asset boundary", async t => {
  const f = await recoveryFixture(t), link = join(f.root, "redirect");
  try { await symlink(f.root, link, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (error && typeof error === "object" && "code" in error && ["EPERM", "EACCES", "ENOTSUP"].includes(String(error.code))) { t.skip("OS denied creation of synthetic link"); return; } throw error; }
  f.cleanup.push(() => process.platform === "win32" ? rmdir(link) : unlink(link));
  await assert.rejects(createRecoveryArchiveSource(f.cloudSource, f.map, link).read("public", f.key, 100), isCode("ARCHIVE_RECOVERY_PATH_INVALID"));
});

test("partial I/O with recovered media resumes without duplicate objects or business mutation", async t => {
  const f = await recoveryFixture(t), manifest = await prepare(f); f.counters.failAfterPut = 2;
  const options = { ...f.options(manifest), source: f.source };
  await assert.rejects(applyArchiveManifest(manifest, options), /synthetic-unknown-ACK/);
  assert.equal(f.state.visible.size, 0); assert.equal(f.counters.publishes, 0);
  f.counters.failAfterPut = 0;
  await applyArchiveManifest(manifest, options);
  assert.equal(f.counters.puts, allArchiveObjects(manifest).length); assert.equal(f.counters.publishes, 1);
  assert.equal(f.counters.sourceWrites, 0); assert.equal(valueHash(f.state.business), f.originalBusinessHash);
});

test("recovery source still enforces frozen LIST, raw document hashes and normal R2 image hashes", async t => {
  for (const mutation of ["LIST", "RAW", "IMAGE"] as const) {
    const f = await recoveryFixture(t), manifest = await prepare(f);
    if (mutation === "LIST") f.set("public", `documents/${Date.UTC(2023, 2, 1)}-zzzzzzz.json`, { unexpected: true });
    if (mutation === "RAW") { const raw = f.cloud.get(`public:documents/${f.ids[1]}.json`)!; raw.bytes[raw.bytes.length - 3] ^= 1; }
    if (mutation === "IMAGE") f.cloud.get("public:kp/photo-1.jpg")!.bytes[0] ^= 1;
    await assert.rejects(applyArchiveManifest(manifest, { ...f.options(manifest), source: f.source }), isCode("ARCHIVE_SOURCE_INVENTORY_CHANGED", "ARCHIVE_SOURCE_CHANGED"));
    assert.equal(f.counters.reserves, 0); assert.equal(f.counters.puts, 0);
  }
});
