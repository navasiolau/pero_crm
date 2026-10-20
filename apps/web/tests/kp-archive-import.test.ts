import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { sharedTargetIO } from "../scripts/kp/archive-import";
import * as mediaStorage from "../src/server/kp/media-storage";
import * as mediaContract from "../src/server/kp/media-contract";
import { createProposalArtifactStorage } from "../src/server/kp/artifact-storage";
import { applyArchiveManifest } from "../src/server/kp/archive/apply";
import { ArchiveImportError, assertArchiveDatabaseIdentity, byteHash, canonical, valueHash, type TargetProfile } from "../src/server/kp/archive/contract";
import { allArchiveObjects, archiveReport, prepareArchiveManifest, validateArchiveManifest } from "../src/server/kp/archive/manifest";
import { sourceConfigurationFromEnvironment } from "../src/server/kp/archive/source";
import { archiveFixture } from "./helpers/kp-archive-fixture";

const isCode = (...codes: string[]) => (error: unknown) => error instanceof ArchiveImportError && codes.includes(error.code);
const sourceEnvironment = () => ({ R2_ACCOUNT_ID: "synthetic-account", R2_BUCKET_NAME: "synthetic-public", CONTRACTS_R2_BUCKET_NAME: "synthetic-contracts", R2_PUBLIC_URL: "https://source.example.invalid", R2_ACCESS_KEY_ID: "synthetic-public-key", R2_SECRET_ACCESS_KEY: "synthetic-public-secret" });

function cliTargetStorage(binding: TargetProfile["storage"], bytes: Buffer) {
  const configuration = { mode: "s3" as const, ...binding, endpoint: new URL(binding.endpoint).toString(),
    region: binding.region ?? "us-east-1", accessKeyId: "SYNTHETIC_KEY", secretAccessKey: "SYNTHETIC_SECRET" };
  const counters = { puts: 0, gets: 0 };
  // Настоящий SDK сериализует команды, но весь HTTP остаётся в memory handler.
  const client = new S3Client({ ...configuration, forcePathStyle: true, maxAttempts: 1,
    credentials: { accessKeyId: configuration.accessKeyId, secretAccessKey: configuration.secretAccessKey },
    requestHandler: { handle: async (request: { method: string }) => {
      assert.ok(["PUT", "GET"].includes(request.method), "synthetic-unexpected-S3-command");
      if (request.method === "PUT") counters.puts++; else counters.gets++;
      return { response: { statusCode: 200, headers: request.method === "GET" ? { "content-length": String(bytes.length) } : {},
        body: Readable.from(request.method === "GET" ? [bytes] : []) } };
    } } });
  const images = mediaStorage.createProposalMediaS3Storage({ configuration: () => configuration, client: () => client });
  const artifacts = createProposalArtifactStorage({ configuration: () => configuration, client: () => client });
  const io = sharedTargetIO(name => {
    if (name === "media-storage") return { ...mediaStorage, createProposalMediaS3Storage: () => images };
    if (name === "media-contract") return mediaContract;
    assert.equal(name, "artifact-storage"); return { createProposalArtifactStorage: () => artifacts };
  });
  return { io, images, counters, close: () => client.destroy() };
}

test("CLI shared target normalizes the same media endpoint before immutable Put and readback", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links);
  const object = allArchiveObjects(manifest).find(value => value.role === "optimized")!, bytes = f.cloud.get("public:" + object.source.key)!.bytes;
  const target = cliTargetStorage(manifest.target.storage, bytes);
  try {
    assert.equal(target.images.currentBinding().endpoint, object.binding.endpoint + "/");
    assert.equal(canonical(target.io.binding()), canonical(manifest.target.storage));
    assert.deepEqual(await target.io.ensure(object, bytes, async () => {}), { key: object.key, sha256: object.sha256, size: object.size });
    assert.deepEqual(target.counters, { puts: 1, gets: 1 });
  } finally { target.close(); }
});

test("CLI shared target refuses changed endpoint, bucket, region or region presence before Put", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links);
  const object = allArchiveObjects(manifest).find(value => value.role === "optimized")!, bytes = f.cloud.get("public:" + object.source.key)!.bytes;
  const { region: _region, ...withoutRegion } = object.binding; void _region;
  for (const binding of [{ ...object.binding, endpoint: "http://127.0.0.2:9000" }, { ...object.binding, bucket: "foreign-bucket" },
    { ...object.binding, region: "us-east-2" }, withoutRegion]) {
    const target = cliTargetStorage(manifest.target.storage, bytes);
    try {
      await assert.rejects(target.io.ensure({ ...object, binding }, bytes, async () => {}), isCode("ARCHIVE_TARGET_STORAGE_CHANGED"));
      assert.deepEqual(target.counters, { puts: 0, gets: 0 });
    } finally { target.close(); }
  }
});

test("LIST full milliseconds and whole-second GET prepare without losing frozen LIST precision", async () => {
  const f = archiveFixture(), list = f.source.list;
  f.source.list = async (area, prefix) => (await list(area, prefix)).map(row => ({ ...row,
    modifiedAt: row.modifiedAt ? new Date(Date.parse(row.modifiedAt) + 542).toISOString() : null }));
  const manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links);
  assert.equal(manifest.inventory.length, 36);
  assert.equal(manifest.inventory.every(row => row.modifiedAt?.endsWith(".542Z")), true);
  assert.equal(manifest.proposals.every(row => row.sourceObject.modifiedAt?.endsWith(".000Z")), true);
  assert.equal(validateArchiveManifest(manifest, f.deps).sha256, manifest.sha256);
  await applyArchiveManifest(manifest, f.options(manifest));
  assert.equal(f.counters.publishes, 1); assert.equal(f.counters.sourceWrites, 0);
});

test("LIST millisecond drift within the same second still stops the final prepare inventory check", async () => {
  const f = archiveFixture(), list = f.source.list;
  let documentLists = 0;
  f.source.list = async (area, prefix) => {
    if (prefix === "documents/") documentLists++;
    const millis = prefix === "documents/" && documentLists > 1 ? 543 : 542;
    return (await list(area, prefix)).map(row => ({ ...row, modifiedAt: row.modifiedAt ? new Date(Date.parse(row.modifiedAt) + millis).toISOString() : null }));
  };
  await assert.rejects(prepareArchiveManifest(f.source, f.target, f.deps, f.links), isCode("ARCHIVE_SOURCE_INVENTORY_CHANGED"));
  assert.equal(documentLists, 2); assert.equal(f.counters.reserves, 0); assert.equal(f.counters.sourceWrites, 0);
});

test("different precise GET milliseconds and a different GET second remain source drift", async () => {
  for (const getMillis of [543, 1000]) {
    const f = archiveFixture(), list = f.source.list, read = f.source.read, documentKey = `documents/${f.ids[0]}.json`;
    f.source.list = async (area, prefix) => (await list(area, prefix)).map(row => row.key === documentKey && row.modifiedAt
      ? { ...row, modifiedAt: new Date(Date.parse(row.modifiedAt) + 542).toISOString() } : row);
    f.source.read = async (area, key, maxBytes) => {
      const row = await read(area, key, maxBytes);
      return key === documentKey && row.modifiedAt ? { ...row, modifiedAt: new Date(Date.parse(row.modifiedAt) + getMillis).toISOString() } : row;
    };
    await assert.rejects(prepareArchiveManifest(f.source, f.target, f.deps, f.links), isCode("ARCHIVE_SOURCE_INVENTORY_CHANGED"));
    assert.equal(f.counters.reserves, 0);
  }
});

test("source environment treats empty optional endpoints and credentials as absent", () => {
  const configuration = sourceConfigurationFromEnvironment({ ...sourceEnvironment(), R2_ENDPOINT: "", CONTRACTS_R2_ENDPOINT: "", CONTRACTS_R2_ACCOUNT_ID: "", CONTRACTS_R2_ACCESS_KEY_ID: "", CONTRACTS_R2_SECRET_ACCESS_KEY: "" });
  assert.equal(configuration.profile.public.endpoint, "https://synthetic-account.r2.cloudflarestorage.com");
  assert.equal(configuration.profile.contracts.endpoint, configuration.profile.public.endpoint);
  assert.deepEqual(configuration.credentials.contracts, configuration.credentials.public);
  const credentialFallback = sourceConfigurationFromEnvironment({ ...sourceEnvironment(), CONTRACTS_R2_ACCESS_KEY_ID: "", CONTRACTS_R2_SECRET_ACCESS_KEY: "" });
  assert.deepEqual(credentialFallback.credentials.contracts, credentialFallback.credentials.public);
  const separateAccount = sourceConfigurationFromEnvironment({ ...sourceEnvironment(), CONTRACTS_R2_ENDPOINT: "", CONTRACTS_R2_ACCOUNT_ID: "synthetic-contract-account" });
  assert.equal(separateAccount.profile.contracts.endpoint, "https://synthetic-contract-account.r2.cloudflarestorage.com");
});

test("source environment preserves explicit nonempty endpoint and credential overrides", () => {
  const configuration = sourceConfigurationFromEnvironment({ ...sourceEnvironment(), R2_ACCOUNT_ID: undefined, R2_ENDPOINT: "https://public-store.example.invalid", CONTRACTS_R2_ACCOUNT_ID: "ignored-account", CONTRACTS_R2_ENDPOINT: "https://contract-store.example.invalid", CONTRACTS_R2_ACCESS_KEY_ID: "synthetic-private-key", CONTRACTS_R2_SECRET_ACCESS_KEY: "synthetic-private-secret" });
  assert.equal(configuration.profile.public.endpoint, "https://public-store.example.invalid");
  assert.equal(configuration.profile.contracts.endpoint, "https://contract-store.example.invalid");
  assert.deepEqual(configuration.credentials.contracts, { accessKeyId: "synthetic-private-key", secretAccessKey: "synthetic-private-secret" });
  assert.throws(() => sourceConfigurationFromEnvironment({ ...sourceEnvironment(), CONTRACTS_R2_ENDPOINT: "https://contract-store.example.invalid?unexpected=1" }), isCode("ARCHIVE_BINDING_INVALID"));
});

test("source environment rejects every partially configured optional credential pair", () => {
  for (const pair of [
    { CONTRACTS_R2_ACCESS_KEY_ID: "synthetic-private-key", CONTRACTS_R2_SECRET_ACCESS_KEY: "" },
    { CONTRACTS_R2_ACCESS_KEY_ID: "", CONTRACTS_R2_SECRET_ACCESS_KEY: "synthetic-private-secret" },
    { CONTRACTS_R2_ACCESS_KEY_ID: "synthetic-private-key" },
    { CONTRACTS_R2_SECRET_ACCESS_KEY: "synthetic-private-secret" },
  ]) assert.throws(() => sourceConfigurationFromEnvironment({ ...sourceEnvironment(), ...pair }), isCode("ARCHIVE_SOURCE_CREDENTIALS_INCOMPLETE"));
});

test("database identity pins the distinct local and staging users without accepting cross-target credentials", () => {
  const local = archiveFixture().target;
  const staging: TargetProfile = { ...local, database: { kind: "staging", containerId: "b".repeat(64), name: "crm", schema: "public", host: "db", port: 5432, volume: "crm-staging_pgdata", revision: "d".repeat(40) } };
  assertArchiveDatabaseIdentity(local, { database: "pero_crm", schema: "public", user: "pero" });
  assertArchiveDatabaseIdentity(staging, { database: "crm", schema: "public", user: "crm" });
  for (const [target, identity] of [
    [local, { database: "pero_crm", schema: "public", user: "crm" }],
    [staging, { database: "crm", schema: "public", user: "pero" }],
    [staging, { database: "pero_crm", schema: "public", user: "crm" }],
    [staging, { database: "crm", schema: "other", user: "crm" }],
  ] as const) assert.throws(() => assertArchiveDatabaseIdentity(target, identity), isCode("ARCHIVE_DATABASE_GUARD_MISMATCH"));
});

test("different legacy image URLs with identical bytes keep deterministic distinct owned keys", async () => {
  const f = archiveFixture(), sourceImage = f.cloud.get("public:kp/photo-0.jpg")!, documentKey = `documents/${f.ids[0]}.json`;
  const record = JSON.parse(f.cloud.get("public:" + documentKey)!.bytes.toString("utf8")) as { state: { items: { image2?: string }[] } };
  record.state.items[0].image2 = f.sourceProfile.publicBaseUrl + "/kp/same-bytes.jpg";
  f.set("public", "kp/same-bytes.jpg", sourceImage.bytes, sourceImage.mimeType, sourceImage.modifiedAt);
  f.set("public", documentKey, record);
  const manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links), proposal = manifest.proposals.find(value => value.legacyId === f.ids[0])!;
  assert.equal(proposal.media.length, 2);
  assert.equal(proposal.media[0].optimized.sha256, proposal.media[1].optimized.sha256);
  assert.notEqual(proposal.media[0].optimized.key, proposal.media[1].optimized.key);
  assert.notEqual(proposal.state.items[0].image, proposal.state.items[0].image2);
  assert.equal(validateArchiveManifest(manifest, f.deps).sha256, manifest.sha256);
  assert.equal((await prepareArchiveManifest(f.source, f.target, f.deps, f.links)).sha256, manifest.sha256);
  await applyArchiveManifest(manifest, f.options(manifest));
  const puts = f.counters.puts;
  await applyArchiveManifest(manifest, f.options(manifest));
  assert.equal(f.counters.puts, puts);
  for (const media of proposal.media) assert.deepEqual(f.blobs.get(media.optimized.key), sourceImage.bytes);
});

test("discovery captures23/189/6/7 and retains all7unlinked DOCX without inventing history", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps);
  assert.deepEqual(manifest.counts, { proposals: 23, items: 189, settings: 6, docx: 7 });
  const report = archiveReport(manifest); assert.equal(report.unlinkedDocx.length, 7); assert.equal(report.applicable, false);
  assert.equal(manifest.docx.every(value => value.artifact === null && !value.reviewed), true);
  assert.equal(manifest.unknowns.filter(value => value.field === "docx.historicalSettings").length, 7);
  await assert.rejects(applyArchiveManifest(manifest, f.options(manifest)), isCode("ARCHIVE_REVIEW_REQUIRED"));
  assert.equal(f.counters.reserves + f.counters.puts, 0);
});

test("dryrun is default and performs no DB/source/target operations after frozen validation", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links);
  const before = { ...f.counters };
  const report = await applyArchiveManifest(manifest, { ...f.options(manifest), apply: false });
  assert.equal(report.mode, "dry-run"); assert.deepEqual(f.counters, before);
});

test("canonical refs preserve raw unknown fields, numbers, originaldates and absent original", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links);
  const document = manifest.proposals.find(value => value.legacyId === f.ids[0])!;
  const raw = JSON.parse(Buffer.from(document.rawBase64, "base64").toString("utf8")) as { extraTop: { keep: boolean }; state: { items: { image: string }[] } };
  assert.equal(raw.extraTop.keep, true); assert.equal(raw.state.items[0].image, f.sourceProfile.publicBaseUrl + "/kp/photo-0.jpg");
  assert.deepEqual(document.state.unknownBlock, { nested: ["unchanged", 7] }); assert.equal(document.sourceNumber, "100");
  assert.equal(document.createdAt, "2023-01-01T00:00:00.000Z"); assert.equal(document.createdAtConfidence, "IDderived"); assert.equal(document.media[0].expiresAt, "2024-01-01T00:00:00.000Z");
  assert.equal(document.media[0].original, null); assert.match(String(document.state.items[0].image), /^kp-media:kp_a_m_/);
  assert.equal(document.state.items.every(item => typeof item.id === "string"), true);
  assert.equal(validateArchiveManifest(manifest, f.deps).sha256, manifest.sha256);
});

test("apply publishes wholearchive, independent contracthistory and 1baseditems; replay creates0duplicates", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links), objects = allArchiveObjects(manifest);
  const applied = await applyArchiveManifest(manifest, f.options(manifest));
  assert.equal(applied.mode, "applied"); assert.equal(f.state.visible.size, 23); assert.equal(f.state.hidden.size, 0);
  assert.equal(f.state.contractHistory.length, 7); assert.equal(f.state.itemPositions.length, 189); assert.equal(f.state.itemPositions.every(position => position > 0), true);
  assert.equal(f.counters.puts, objects.length); assert.equal(valueHash(f.state.business), f.originalBusinessHash); assert.equal(f.counters.sourceWrites, 0);
  const puts = f.counters.puts, again = await applyArchiveManifest(manifest, f.options(manifest));
  assert.equal(again.mode, "applied"); if (again.mode !== "applied") throw Error("test-applied");
  assert.equal(again.replayed, true); assert.deepEqual(again.created, { proposals: 0, items: 0, settings: 0, docx: 0 });
  assert.equal(f.counters.puts, puts); assert.equal(f.counters.publishes, 1);
});

test("partial I/O and uncertain ACK resume by verified hashes without duplicate objects", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links);
  f.counters.failAfterPut = 2;
  await assert.rejects(applyArchiveManifest(manifest, f.options(manifest)), /synthetic-unknown-ACK/);
  assert.equal(f.state.visible.size, 0); assert.equal(f.state.hidden.size, 23); assert.equal(f.blobs.size, 2); assert.equal(f.state.jobsState, "FAILED");
  f.counters.failAfterPut = 0;
  await applyArchiveManifest(manifest, f.options(manifest));
  assert.equal(f.counters.puts, allArchiveObjects(manifest).length); assert.equal(f.state.visible.size, 23); assert.equal(valueHash(f.state.business), f.originalBusinessHash);
});

test("last publication failure exposes no partial archive and retry only publishes metadata", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links);
  f.counters.failPublish = true;
  await assert.rejects(applyArchiveManifest(manifest, f.options(manifest)), /synthetic-final-SQL-fault/);
  assert.equal(f.state.visible.size, 0); assert.equal(f.state.contractHistory.length, 0); assert.equal(valueHash(f.state.business), f.originalBusinessHash);
  const puts = f.counters.puts; f.counters.failPublish = false;
  await applyArchiveManifest(manifest, f.options(manifest)); assert.equal(f.counters.puts, puts); assert.equal(f.state.contractHistory.length, 7);
});

test("source drift, missing image and foreign image host stop before business publication", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links), key = "public:documents/" + f.ids[0] + ".json";
  const old = f.cloud.get(key)!, changed = JSON.parse(old.bytes.toString("utf8")) as { state: { items: { image: string; title: string }[] } }; changed.state.items[0].title = "Source changed";
  f.set("public", "documents/" + f.ids[0] + ".json", changed);
  await assert.rejects(applyArchiveManifest(manifest, f.options(manifest)), isCode("ARCHIVE_SOURCE_INVENTORY_CHANGED", "ARCHIVE_SOURCE_CHANGED")); assert.equal(f.counters.reserves, 0);
  const missing = archiveFixture(); missing.cloud.delete("public:kp/photo-0.jpg");
  await assert.rejects(prepareArchiveManifest(missing.source, missing.target, missing.deps, missing.links), isCode("ARCHIVE_SOURCE_MISSING"));
  changed.state.items[0].image = "https://foreign.example.invalid/kp/photo.jpg"; f.set("public", "documents/" + f.ids[0] + ".json", changed);
  await assert.rejects(prepareArchiveManifest(f.source, f.target, f.deps, f.links), isCode("ARCHIVE_IMAGE_FOREIGN_HOST")); assert.equal(f.counters.sourceWrites, 0);
});

test("same-size source byte change with unchanged metadata after copy prevents final publication", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links), originalEnsure = f.io.ensure;
  let changed = false;
  f.io.ensure = async (object, bytes, authorize) => {
    const result = await originalEnsure(object, bytes, authorize);
    if (!changed && object.role === "optimized" && object.source.key === "kp/photo-0.jpg") {
      const prior = f.cloud.get("public:" + object.source.key)!, altered = Buffer.from(prior.bytes);
      altered[0] ^= 1;
      changed = true; f.set("public", object.source.key, altered, prior.mimeType, prior.modifiedAt);
      const current = f.cloud.get("public:" + object.source.key)!;
      assert.equal(current.bytes.length, prior.bytes.length); assert.equal(current.modifiedAt, prior.modifiedAt);
      assert.notEqual(byteHash(current.bytes), byteHash(prior.bytes));
    }
    return result;
  };
  await assert.rejects(applyArchiveManifest(manifest, f.options(manifest)), isCode("ARCHIVE_SOURCE_CHANGED"));
  assert.equal(changed, true); assert.equal(f.counters.publishes, 0); assert.equal(f.state.visible.size, 0); assert.equal(f.state.hidden.size, 23); assert.equal(valueHash(f.state.business), f.originalBusinessHash);
});

test("different target bytes are never overwritten; guard mismatch precedes reservation", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links), first = allArchiveObjects(manifest)[0];
  f.blobs.set(first.key, Buffer.from("foreign bytes"));
  await assert.rejects(applyArchiveManifest(manifest, f.options(manifest)), isCode("ARCHIVE_READBACK_MISMATCH")); assert.equal(f.blobs.get(first.key)?.toString(), "foreign bytes"); assert.equal(f.state.visible.size, 0);
  const guarded = archiveFixture(), known = await prepareArchiveManifest(guarded.source, guarded.target, guarded.deps, guarded.links);
  guarded.io.binding = () => ({ ...guarded.target.storage, bucket: "foreign-bucket" });
  await assert.rejects(applyArchiveManifest(known, guarded.options(known)), isCode("ARCHIVE_TARGET_STORAGE_CHANGED")); assert.equal(guarded.counters.reserves, 0);
});

test("optional real original and optimized bytes are separately hashed and copied without reencoding", async () => {
  const f = archiveFixture(), original = Buffer.from("synthetic original PNG bytes"); f.set("public", "kp/original.png", original, "image/png");
  const manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links, { "kp/photo-0.jpg": "kp/original.png" });
  const media = manifest.proposals.find(value => value.legacyId === f.ids[0])!.media[0]; assert.ok(media.original); assert.equal(media.original.sha256, byteHash(original));
  await applyArchiveManifest(manifest, f.options(manifest)); assert.deepEqual(f.blobs.get(media.original.key), original);
  assert.deepEqual(f.blobs.get(media.optimized.key), f.cloud.get("public:kp/photo-0.jpg")!.bytes);
});

test("manifest tampering and source bucket as target are rejected even when region differs", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links);
  const edited = structuredClone(manifest); edited.proposals[0].state.items[0].title = "tampered";
  await assert.rejects(applyArchiveManifest(edited, f.options(edited)), isCode("ARCHIVE_MANIFEST_HASH_MISMATCH"));
  const { sha256: _oldHash, ...payload } = edited; void _oldHash; edited.sha256 = valueHash(payload);
  assert.throws(() => validateArchiveManifest(edited, f.deps), isCode("ARCHIVE_CANONICAL_STATE_MISMATCH"));
  await assert.rejects(prepareArchiveManifest(f.source, { ...f.target, storage: { ...f.sourceProfile.public, region: "another" } }, f.deps, f.links), isCode("ARCHIVE_TARGET_IS_SOURCE"));
  assert.throws(() => sourceConfigurationFromEnvironment({ CONTRACTS_R2_ACCESS_KEY_ID: "synthetic-only" }), isCode("ARCHIVE_SOURCE_CREDENTIALS_INCOMPLETE"));
});

test("legitimate policy purge is reconciled without resurrecting image bytes or touching DOCX", async () => {
  const f = archiveFixture(), manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links);
  await applyArchiveManifest(manifest, f.options(manifest));
  const image = allArchiveObjects(manifest).find(value => value.role === "optimized")!; f.blobs.delete(image.key); f.state.policyPurgedObjectIds.push(image.id);
  const puts = f.counters.puts; await applyArchiveManifest(manifest, f.options(manifest));
  assert.equal(f.counters.puts, puts); assert.equal(f.blobs.has(image.key), false); assert.equal(f.state.contractHistory.length, 7);
});

test("invalid current contract draft is preserved and does not drop immutable DOCX history", async () => {
  const f = archiveFixture(), key = `contracts/${f.ids[0]}.json`, row = f.cloud.get("contracts:" + key)!;
  const record = JSON.parse(row.bytes.toString("utf8")) as { settings: { payments: string } }; record.settings.payments = "legacy invalid draft";
  f.set("contracts", key, record, "application/json", row.modifiedAt);
  const nullKey = `contracts/${f.ids[1]}.json`, nullRow = f.cloud.get("contracts:" + nullKey)!;
  const nullRecord = JSON.parse(nullRow.bytes.toString("utf8")) as { settings: unknown }; nullRecord.settings = null;
  f.set("contracts", nullKey, nullRecord, "application/json", nullRow.modifiedAt);
  const manifest = await prepareArchiveManifest(f.source, f.target, f.deps, f.links);
  await applyArchiveManifest(manifest, f.options(manifest));
  assert.equal(manifest.settings.find(value => value.legacyId === f.ids[0])!.settings.payments, "legacy invalid draft");
  const nullSettings = manifest.settings.find(value => value.legacyId === f.ids[1])!;
  assert.deepEqual(nullSettings.settings, {}); assert.equal((JSON.parse(Buffer.from(nullSettings.rawBase64, "base64").toString("utf8")) as { settings: unknown }).settings, null);
  assert.equal(f.state.contractHistory.length, 7); assert.equal(canonical(f.state.business), canonical({ projects: ["real-project"], products: ["real-product"], clients: ["real-client"], payments: ["real-payment"] }));
});
