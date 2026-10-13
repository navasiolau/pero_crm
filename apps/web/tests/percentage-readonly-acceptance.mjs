/** Чистые проверки сохранности исторической percentage-миграции; без CLI, дампов и записи. */
import { createHash } from "node:crypto";

const BASE_TABLES = Object.freeze(["User", "Client", "Project", "Product", "ProductStatusHistory", "ProjectStageHistory",
  "Task", "TaskAllocationGroup", "TaskDependency", "PriceItem", "Work", "TimeEntry", "PayrollEntry", "ProductStagePayPool",
  "WorkPaymentConversion", "ProductStageSettlement", "ProductStageSettlementShare", "Payout", "CashAccount", "ExpenseArticle",
  "Payment", "OrgSetting", "MaterialCategory", "Material", "ProjectMaterial", "StockMovement", "File", "Communication",
  "Notification", "NotificationPreference", "UserPreference", "Plugin", "PluginSetting", "PluginRunLog", "DomainEvent",
  "ApiToken", "ChangeLog", "TelegramLink"]);
function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") { check(Number.isFinite(value), "INVALID_JSON_NUMBER"); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  check(value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype, "INVALID_JSON_OBJECT");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

export const TARGET_LOCAL = Object.freeze({ kind: "EXISTING_LOCAL",
  containerId: "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5",
  name: "/pero_crm_pg", volume: "pero_crm_v2_pgdata", host: "127.0.0.1", port: 5433,
  database: "pero_crm", user: "pero" });
export const TARGET_STAGE = Object.freeze({ kind: "EXISTING_STAGING", guest: "crm-staging",
  containerId: "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a",
  host: "db", port: 5432, database: "crm", user: "crm", origin: "http://192.168.0.30" });
export const MIGRATIONS = Object.freeze([
  { name: "20260930145000_product_percentage_enum_values", sha256: "2d5ea9ef028cf9c38dff0bd4030846a8bca5f39d197e473cc7731ee73d017f17" },
  { name: "20260930150000_product_percentage_pay", sha256: "7c0b2bf77c10418a534fca63a4d7b7c4d77c4c3ac7033aa69ff433bf14a42a6a" },
]);
export const NEW_TABLES = Object.freeze(["ProductPercentageConfig", "ProductPercentageParticipant",
  "ProductPercentageCompletion", "ProductPercentageCompletionShare"]);
const OPTIONAL = new Set(["ProductCompositionRevision", "ProductCompositionItem"]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => canonical(a) === canonical(b);
export class ReadonlyStop extends Error { constructor(code) { super(code); this.name = "ReadonlyStop"; this.code = code; } }
export function check(ok, code) { if (!ok) throw new ReadonlyStop(code); }
export function digest(value) { return sha(canonical(value) + "\n"); }

export function tables(phase, optional = []) {
  check(["before", "after"].includes(phase) && Array.isArray(optional) && new Set(optional).size === optional.length &&
    optional.every((name) => OPTIONAL.has(name)), "SCHEMA_TABLE_ALLOWLIST_INVALID");
  return [...BASE_TABLES, ...(phase === "after" ? NEW_TABLES : []), ...optional].sort();
}
export function key(table, row) {
  if (table === "OrgSetting") return row.key;
  if (table === "TaskDependency") return `${row.taskId}|${row.dependsOnId}`;
  if (table === "NotificationPreference") return `${row.userId}|${row.type}`;
  if (table === "UserPreference") return `${row.userId}|${row.key}`;
  if (table === "PluginSetting") return `${row.pluginId}|${row.key}`;
  return row.id;
}

/** Only the migration comparison omits its three new default columns. */
export function originalFingerprints(snapshot, phase) {
  const optional = snapshot.optionalTables ?? [];
  check(same(Object.keys(snapshot.rows ?? {}).sort(), tables(phase, optional)), "SNAPSHOT_TABLE_SET_DRIFT");
  return Object.fromEntries(tables("before", optional).map((table) => {
    const rows = snapshot.rows[table].map((raw) => {
      const item = JSON.parse(raw);
      if (phase === "after") {
        if (table === "Product") { check(item.noModel === false, "OLD_PRODUCT_CHANGED"); delete item.noModel; }
        if (table === "Task") { check(item.physicalOnlyShare === false, "OLD_TASK_CHANGED"); delete item.physicalOnlyShare; }
        if (table === "PayrollEntry") { check(item.percentageCompletionShareId === null, "OLD_PAYROLL_CHANGED"); delete item.percentageCompletionShareId; }
      }
      if (snapshot.targetKind === TARGET_STAGE.kind && table === "ApiToken") delete item.lastUsedAt;
      return [key(table, item), canonical(item)];
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return [table, sha(rows.map(([id, raw]) => `${id}:${raw}`).join("\n") + "\n")];
  }));
}

export function fullFingerprints(snapshot) {
  check(same(Object.keys(snapshot.rows ?? {}).sort(), tables("after", snapshot.optionalTables ?? [])), "SNAPSHOT_TABLE_SET_DRIFT");
  return Object.fromEntries(tables("after", snapshot.optionalTables ?? []).map((table) => {
    const rows = snapshot.rows[table].map((raw) => {
      const item = JSON.parse(raw);
      if (snapshot.targetKind === TARGET_STAGE.kind && table === "ApiToken") delete item.lastUsedAt;
      return [key(table, item), canonical(item)];
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    return [table, sha(rows.map(([id, raw]) => `${id}:${raw}`).join("\n") + "\n")];
  }));
}

export function assertExactlyPending(sourceNames, ledger) {
  check(Array.isArray(sourceNames) && Array.isArray(ledger) && ledger.every((row) => row.finished_at || row.rolled_back_at),
    "MIGRATION_LEDGER_UNFINISHED");
  const names = new Set(sourceNames);
  check(ledger.every((row) => names.has(row.migration_name)), "MIGRATION_HISTORY_UNKNOWN_SOURCE");
  const applied = new Set(ledger.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => row.migration_name));
  check(same(sourceNames.filter((name) => !applied.has(name)).sort(), MIGRATIONS.map((row) => row.name)),
    "PENDING_MIGRATIONS_NOT_EXACT_TWO");
  return true;
}
export function assertApplied(ledger) {
  check(Array.isArray(ledger) && ledger.every((row) => row.finished_at || row.rolled_back_at), "MIGRATION_LEDGER_UNFINISHED");
  for (const migration of MIGRATIONS) {
    const found = ledger.filter((row) => row.migration_name === migration.name);
    check(found.length === 1 && found[0].finished_at && !found[0].rolled_back_at &&
      found[0].checksum?.toLowerCase() === migration.sha256, "MIGRATION_CHECKSUM_OR_STATUS_DRIFT");
  }
  return true;
}

/** Compatibility markers are expected migration output, never a QA fixture. */
export function assertCompatibilityMarkers(before, after) {
  check(after.rows.ProductPercentageConfig.length === 0 && after.rows.ProductPercentageParticipant.length === 0 &&
    after.rows.ProductPercentageCompletionShare.length === 0, "NEW_PERCENTAGE_ROWS_UNEXPECTED");
  const products = before.rows.Product.map((raw) => JSON.parse(raw));
  const histories = before.rows.ProductStatusHistory.map((raw) => JSON.parse(raw));
  const pools = before.rows.ProductStagePayPool.map((raw) => JSON.parse(raw));
  const payroll = before.rows.PayrollEntry.map((raw) => JSON.parse(raw));
  const projects = new Map(before.rows.Project.map((raw) => { const row = JSON.parse(raw); return [row.id, row]; }));
  const expected = [];
  for (const product of products) {
    const normal = ["PRODUCTION", "STORAGE", "INSTALLATION", "DONE"];
    if (normal.includes(product.status) || histories.some((row) => row.productId === product.id && normal.includes(row.toStatus)) ||
      pools.some((row) => row.productId === product.id && row.kind === "ENGINEERING" && ["SETTLED", "LEGACY_PROTECTED"].includes(row.state)) ||
      payroll.some((row) => row.projectId === product.projectId && row.scheme === "PERCENT_PROJECT"))
      expected.push([product.id, "ENGINEERING"]);
    if (product.status === "DONE" || histories.some((row) => row.productId === product.id && row.toStatus === "DONE"))
      expected.push([product.id, "INSTALLATION"]);
  }
  const found = after.rows.ProductPercentageCompletion.map((raw) => JSON.parse(raw));
  check(found.length === expected.length && same(found.map((row) => [row.productId, row.kind]).sort(), expected.sort()) &&
    found.every((row) => row.state === "LEGACY_PROTECTED" && row.amount === null && row.bynAmount === null &&
      row.projectAmount === null && row.ratePercentSnapshot === null && row.payrollCurrency === null &&
      row.id === `legacy-${row.kind.toLowerCase()}:${row.productId}` &&
      (row.priceSnapshot === null
        ? products.find((p) => p.id === row.productId)?.expectedPrice == null
        : Number(row.priceSnapshot) === Number(products.find((p) => p.id === row.productId)?.expectedPrice)) &&
      row.productCurrency === projects.get(products.find((p) => p.id === row.productId)?.projectId)?.currency),
  "COMPATIBILITY_MARKER_SET_DRIFT");
  return { count: found.length };
}

export function assertFileMetadata(before, after) {
  const records = (snapshot) => snapshot.rows.File.map((raw) => {
    const row = JSON.parse(raw);
    return [row.id, row.projectId, row.productId, row.storedName, row.fileName, row.size, row.mimeType, row.hasThumb];
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  check(same(records(before), records(after)), "FILE_METADATA_CHANGED");
  return digest(records(after));
}

export function assertStorageInventory(before, after) {
  const normalized = (rows) => {
    check(Array.isArray(rows) && new Set(rows.map((row) => `${row.key}|${row.version ?? ""}`)).size === rows.length &&
      rows.every((row) => row.key && row.etag && Number.isSafeInteger(row.size) && row.size >= 0),
    "STORAGE_METADATA_INVALID");
    return rows.map((row) => [row.key, row.etag, row.size, row.version ?? null, row.latest ?? null, row.deleteMarker ?? null])
      .sort((a, b) => `${a[0]}|${a[3]}`.localeCompare(`${b[0]}|${b[3]}`));
  };
  check(same(normalized(before), normalized(after)), "STORAGE_METADATA_CHANGED");
  return digest(normalized(after));
}

/** Injected read-only DB probe shared by existing local and W07 staging. */
export async function captureReadonly(client, target, phase, optionalTables = [], sourceMigrationNames = []) {
  check(client?.$transaction && (same(target, TARGET_LOCAL) || same(target, TARGET_STAGE)) &&
    ["before", "after"].includes(phase), "READONLY_TARGET_FORBIDDEN");
  const tableNames = tables(phase, optionalTables);
  return client.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
    const [identity] = await tx.$queryRawUnsafe("SELECT current_database() AS database,current_user AS username,inet_server_addr()::text AS address,inet_server_port() AS port,current_schema() AS schema");
    check(identity?.database === target.database && identity.username === target.user && identity.schema === "public" &&
      Number(identity.port) === 5432 && identity.address, "DATABASE_IDENTITY_MISMATCH");
    const found = (await tx.$queryRawUnsafe("SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename"))
      .map((row) => row.name).sort();
    check(same(found, tableNames), "DATABASE_TABLE_SET_DRIFT");
    const ledger = await tx.$queryRawUnsafe('SELECT migration_name,checksum,finished_at,rolled_back_at FROM public."_prisma_migrations" ORDER BY migration_name');
    if (phase === "before") assertExactlyPending(sourceMigrationNames, ledger);
    else assertApplied(ledger);
    const definitions = { tableNames,
      columns: await tx.$queryRawUnsafe("SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position"),
      constraints: await tx.$queryRawUnsafe("SELECT cls.relname AS table_name,c.conname AS name,c.contype AS type,c.convalidated AS validated,pg_get_constraintdef(c.oid,true) AS definition FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class cls ON cls.oid=c.conrelid JOIN pg_catalog.pg_namespace ns ON ns.oid=cls.relnamespace WHERE ns.nspname='public' ORDER BY cls.relname,c.conname"),
      indexes: await tx.$queryRawUnsafe("SELECT tablename AS table_name,indexname AS name,indexdef AS definition FROM pg_catalog.pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname"),
      triggers: await tx.$queryRawUnsafe("SELECT cls.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled,pg_get_triggerdef(t.oid,true) AS definition,pg_get_functiondef(t.tgfoid) AS function_definition FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class cls ON cls.oid=t.tgrelid JOIN pg_catalog.pg_namespace ns ON ns.oid=cls.relnamespace WHERE ns.nspname='public' AND NOT t.tgisinternal ORDER BY cls.relname,t.tgname"),
      enums: await tx.$queryRawUnsafe("SELECT typ.typname AS type,e.enumlabel AS label,e.enumsortorder AS ordinal FROM pg_catalog.pg_enum e JOIN pg_catalog.pg_type typ ON typ.oid=e.enumtypid JOIN pg_catalog.pg_namespace ns ON ns.oid=typ.typnamespace WHERE ns.nspname='public' ORDER BY typ.typname,e.enumsortorder") };
    if (phase === "after") for (const name of ["TaskAllocationGroup_physical_source", "Task_physical_source",
      "ProductPercentageCompletion_frozen", "ProductPercentageCompletionShare_frozen", "PayrollEntry_product_settlement_append_only"])
      check(definitions.triggers.some((row) => row.name === name && row.enabled === "O"), "MIGRATION_TRIGGER_MISSING_OR_DISABLED");
    const rows = {};
    for (const table of tableNames) {
      const result = await tx.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS raw FROM public."${table}" AS t`);
      check(Array.isArray(result) && result.every((row) => typeof row.raw === "string"), "ROW_SNAPSHOT_INVALID");
      rows[table] = result.map((row) => row.raw);
    }
    const snapshot = { targetKind: target.kind, optionalTables, rows };
    return { identity, ledger, schemaHash: digest(definitions), definitions,
      snapshot, oldFingerprints: originalFingerprints(snapshot, phase),
      ...(phase === "after" ? { fullFingerprints: fullFingerprints(snapshot) } : {}) };
  }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 120000 });
}
