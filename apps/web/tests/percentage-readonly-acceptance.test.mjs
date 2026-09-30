import assert from "node:assert/strict";
import { test } from "node:test";
import { assertApplied, assertCompatibilityMarkers, assertExactlyPending, assertFileMetadata,
  assertStorageInventory, captureReadonly, MIGRATIONS, originalFingerprints, tables,
  TARGET_LOCAL } from "./percentage-readonly-acceptance.mjs";
import { assertBackupToc } from "./percentage-readonly-local.mjs";

function empty(phase) { return { targetKind: TARGET_LOCAL.kind, optionalTables: [],
  rows: Object.fromEntries(tables(phase).map((name) => [name, []])) }; }

test("only the two reviewed migrations may be pending, each finished checksum is pinned", () => {
  const source = ["20260901000000_old", ...MIGRATIONS.map((row) => row.name)];
  const old = [{ migration_name: source[0], finished_at: "done", rolled_back_at: null }];
  assert.equal(assertExactlyPending(source, old), true);
  assert.throws(() => assertExactlyPending([...source, "20260930160000_unknown"], old), /PENDING_MIGRATIONS_NOT_EXACT_TWO/);
  assert.equal(assertApplied([...old, ...MIGRATIONS.map((row) => ({ migration_name: row.name,
    checksum: row.sha256, finished_at: "done", rolled_back_at: null }))]), true);
  assert.throws(() => assertApplied([...old, { migration_name: MIGRATIONS[0].name,
    checksum: "0".repeat(64), finished_at: "done", rolled_back_at: null },
    { migration_name: MIGRATIONS[1].name, checksum: MIGRATIONS[1].sha256,
      finished_at: "done", rolled_back_at: null }]), /MIGRATION_CHECKSUM_OR_STATUS_DRIFT/);
});

test("old monetary/business rows remain exact except three new defaults", () => {
  const before = empty("before"), after = empty("after");
  before.rows.Product.push(JSON.stringify({ id: "p", expectedPrice: 100, status: "DESIGN" }));
  after.rows.Product.push(JSON.stringify({ id: "p", expectedPrice: 100, status: "DESIGN", noModel: false }));
  before.rows.Task.push(JSON.stringify({ id: "t", shareAmount: 25 }));
  after.rows.Task.push(JSON.stringify({ id: "t", shareAmount: 25, physicalOnlyShare: false }));
  before.rows.PayrollEntry.push(JSON.stringify({ id: "pay", amount: 25, scheme: "PIECE" }));
  after.rows.PayrollEntry.push(JSON.stringify({ id: "pay", amount: 25, scheme: "PIECE", percentageCompletionShareId: null }));
  assert.deepEqual(originalFingerprints(before, "before"), originalFingerprints(after, "after"));
  after.rows.Work.push(JSON.stringify({ id: "w", paymentKind: "INSTALLATION" }));
  assert.notDeepEqual(originalFingerprints(before, "before"), originalFingerprints(after, "after"));
});

test("migration-only LEGACY_PROTECTED markers are exact and create no new earnings", () => {
  const before = empty("before"), after = empty("after");
  before.rows.Project.push(JSON.stringify({ id: "proj", currency: "BYN" }));
  before.rows.Product.push(JSON.stringify({ id: "p1", projectId: "proj", status: "PRODUCTION" }));
  before.rows.Product.push(JSON.stringify({ id: "p2", projectId: "proj", status: "DONE" }));
  after.rows.ProductPercentageCompletion.push(JSON.stringify({ id: "legacy-engineering:p1", productId: "p1", kind: "ENGINEERING",
    state: "LEGACY_PROTECTED", priceSnapshot: null, ratePercentSnapshot: null, payrollCurrency: null,
    amount: null, bynAmount: null, projectAmount: null, productCurrency: "BYN" }));
  after.rows.ProductPercentageCompletion.push(JSON.stringify({ id: "legacy-engineering:p2", productId: "p2", kind: "ENGINEERING",
    state: "LEGACY_PROTECTED", priceSnapshot: null, ratePercentSnapshot: null, payrollCurrency: null,
    amount: null, bynAmount: null, projectAmount: null, productCurrency: "BYN" }));
  after.rows.ProductPercentageCompletion.push(JSON.stringify({ id: "legacy-installation:p2", productId: "p2", kind: "INSTALLATION",
    state: "LEGACY_PROTECTED", priceSnapshot: null, ratePercentSnapshot: null, payrollCurrency: null,
    amount: null, bynAmount: null, projectAmount: null, productCurrency: "BYN" }));
  assert.deepEqual(assertCompatibilityMarkers(before, after), { count: 3 });
  after.rows.ProductPercentageCompletion[0] = JSON.stringify({ id: "c1", productId: "p1", kind: "ENGINEERING",
    state: "SETTLED", amount: 5, bynAmount: 5, projectAmount: 5, productCurrency: "BYN" });
  assert.throws(() => assertCompatibilityMarkers(before, after), /COMPATIBILITY_MARKER_SET_DRIFT/);
});

test("File metadata and S3 key ETag/size/version stay unchanged without old byte reads", () => {
  const before = empty("before"), after = empty("after");
  const file = { id: "f", projectId: "p", productId: null, storedName: "source.b3d", fileName: "source.b3d",
    size: 9000000, mimeType: "application/octet-stream", hasThumb: false };
  before.rows.File.push(JSON.stringify(file)); after.rows.File.push(JSON.stringify(file));
  assert.match(assertFileMetadata(before, after), /^[a-f0-9]{64}$/);
  const items = [{ key: "p/source.b3d", etag: "etag", size: 9000000, version: "v1" }];
  assert.match(assertStorageInventory(items, items), /^[a-f0-9]{64}$/);
  assert.throws(() => assertStorageInventory(items, [{ ...items[0], version: "v2" }]), /STORAGE_METADATA_CHANGED/);
});

test("injected capture is read-only and rejects target identity before business scans", async () => {
  const seen = [];
  const tx = { $executeRawUnsafe: async (sql) => { seen.push(sql); },
    $queryRawUnsafe: async (sql) => { seen.push(sql);
      if (sql.includes("current_database()")) return [{ database: "wrong", username: "pero", port: 5432, schema: "public" }];
      throw new Error("Business read before identity guard");
    } };
  const client = { $transaction: async (operation) => operation(tx) };
  await assert.rejects(captureReadonly(client, TARGET_LOCAL, "after"), /DATABASE_IDENTITY_MISMATCH/);
  assert.ok(seen[0].includes("SET TRANSACTION READ ONLY"));
  assert.equal(seen.filter((sql) => sql.includes("current_database()")).length, 1);
});

test("verified pg_restore TOC covers every old table plus migration ledger", () => {
  const names = tables("before");
  const toc = ["; Archive created at 2026-09-30", ...[...names, "_prisma_migrations"].map((name, index) =>
    `${index + 1}; 0 ${10000 + index} TABLE DATA public ${name} pero`)].join("\n") + "\n";
  assert.equal(assertBackupToc(toc, names), names.length + 1);
  assert.throws(() => assertBackupToc(toc.replace("TABLE DATA public File", "TABLE DATA public Missing"), names),
    /BACKUP_TOC_TABLE_DATA_MISMATCH/);
});
