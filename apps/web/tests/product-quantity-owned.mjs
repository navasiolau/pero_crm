/** Root-owned opt-in QA. No connections or writes on import. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const keyText = (key) => JSON.stringify(key);
export function apiTokenProtectedHash(row) {
  const protectedRow = { ...row };
  delete protectedRow.lastUsedAt;
  return sha(JSON.stringify(protectedRow));
}
const identityTables = new Set(["User", "Client", "Project", "PriceItem", "Material"]);
const cleanupOrder = ["Notification", "NotificationPreference", "UserPreference", "DomainEvent", "ChangeLog",
  "PayrollEntry", "TimeEntry", "TaskDependency", "Task", "TaskAllocationGroup",
  "ProductPercentageCompletionShare", "ProductPercentageCompletion", "ProductPercentageParticipant", "ProductPercentageConfig",
  "ProductStageSettlementShare", "ProductStageSettlement", "WorkPaymentConversion", "StockMovement",
  "ProjectMaterial", "ProductStatusHistory", "ProjectStageHistory", "Work", "ProductStagePayPool",
  "Product", "Project", "Client", "PriceItem", "Material", "User"];
const historyTriggers = [
  ["PayrollEntry", "PayrollEntry_product_settlement_append_only"],
  ["ProductPercentageCompletion", "ProductPercentageCompletion_frozen"],
  ["ProductPercentageCompletionShare", "ProductPercentageCompletionShare_frozen"],
];

async function triggerSignature(tx) {
  const rows = await tx.$queryRawUnsafe(`SELECT c.relname::text AS table_name,t.tgname::text,t.tgenabled::text,t.tgisinternal,
    pg_get_triggerdef(t.oid) AS definition,pg_get_functiondef(t.tgfoid) AS function_definition,p.prosecdef
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND t.tgname = ANY($1::text[]) ORDER BY t.tgname`,
    historyTriggers.map(([, name]) => name));
  assert.equal(rows.length, historyTriggers.length, "QA_TRIGGER_SET_MISMATCH");
  for (const [table, name] of historyTriggers) {
    const row = rows.find((row) => row.table_name === table && row.tgname === name);
    assert.ok(row && row.tgenabled === "O" && !row.tgisinternal && !row.prosecdef &&
      row.function_definition.includes("append-only"), "QA_TRIGGER_DEFINITION_MISMATCH");
  }
  return sha(JSON.stringify(rows));
}

export async function quantityRows(db) {
  const keys = await db.$queryRawUnsafe(`SELECT tc.table_name::text AS table_name, array_agg(kcu.column_name::text ORDER BY kcu.ordinal_position) AS keys
    FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name=tc.constraint_name AND kcu.table_schema=tc.table_schema
    WHERE tc.table_schema='public' AND tc.constraint_type='PRIMARY KEY' AND tc.table_name <> '_prisma_migrations'
    GROUP BY tc.table_name ORDER BY tc.table_name`);
  const tables = {};
  for (const { table_name: table, keys: columns } of keys) {
    assert.match(table, /^[A-Za-z][A-Za-z0-9_]*$/);
    assert.ok(columns.every((name) => /^[A-Za-z][A-Za-z0-9_]*$/.test(name)));
    const rows = await db.$queryRawUnsafe(`SELECT to_jsonb(t) AS row FROM "${table}" t`);
    tables[table] = rows.map(({ row }) => ({ key: Object.fromEntries(columns.map((name) => [name, row[name]])),
      hash: sha(JSON.stringify(row)), row })).sort((a, b) => keyText(a.key).localeCompare(keyText(b.key)));
  }
  return tables;
}

function fingerprints(tables) {
  return Object.fromEntries(Object.entries(tables).map(([table, rows]) =>
    [table, rows.map(({ key, hash }) => ({ key, hash }))]));
}

export async function prepareQuantityOwned(db, target) {
  assert.ok(["local", "staging"].includes(target), "QA_TARGET_REQUIRED");
  const runId = randomUUID();
  const short = runId.slice(0, 8);
  const marker = `product-quantity-qa-${short}`;
  const ids = Object.fromEntries(["manager", "worker", "client", "project", "control", "price", "material", "income"]
    .map((slot) => [slot, `pq_${short}_${slot}`]));
  const password = randomBytes(24).toString("base64url");
  const passwordHash = await hash(password, { memory: 19456, timeCost: 2, parallelism: 1 });
  const state = await db.$transaction(async (tx) => {
    const rows = await quantityRows(tx);
    const before = fingerprints(rows);
    for (const existing of Object.values(rows).flat()) assert.ok(!Object.values(ids).includes(existing.row.id), "QA_ID_COLLISION");
    const maximum = await tx.project.aggregate({ _max: { numberInt: true } });
    const numberInt = (maximum._max.numberInt ?? 0) + 1;
    assert.ok(Number.isSafeInteger(numberInt) && numberInt < 2147483647);
    const number = String(numberInt);
    const managerEmail = `${marker}-manager@qa.invalid`;
    const workerEmail = `${marker}-worker@qa.invalid`;
    await tx.user.create({ data: { id: ids.manager, name: `QA ${marker} Менеджер-инженер`, email: managerEmail,
      passwordHash, roles: ["MANAGER", "ENGINEER"], payScheme: "PIECE", active: true } });
    await tx.user.create({ data: { id: ids.worker, name: `QA ${marker} Работник-монтажник`, email: workerEmail,
      passwordHash, roles: ["WORKER", "MOUNTER"], payScheme: "PIECE", active: true } });
    await tx.client.create({ data: { id: ids.client, name: `QA ${marker}`, phone: "QA" } });
    await tx.project.create({ data: { id: ids.project, number, numberInt, title: `QA ${marker}`,
      clientId: ids.client, managerId: ids.manager, createdById: ids.manager, currency: "BYN", delivery: "100" } });
    await tx.product.create({ data: { id: ids.control, projectId: ids.project, number: `${number}.1`,
      suffixInt: 1, title: `QA ${marker} Контроль`, quantity: 1, expectedPrice: "0", createdById: ids.manager } });
    await tx.priceItem.create({ data: { id: ids.price, name: `QA ${marker} Сборка`, unit: "шт", price: "30" } });
    await tx.material.create({ data: { id: ids.material, name: `QA ${marker} Петли`, sku: marker, unitId: "warehouse-unit-piece", purchasePrice: "2" } });
    await tx.stockMovement.create({ data: { id: ids.income, materialId: ids.material, type: "INCOME", quantity: "50",
      unitPrice: "2", totalByn: "100", comment: marker, createdById: ids.manager } });
    return { format: "product-quantity-qa/v1", target, runId, marker, ids, number, before,
      apiTokenProtectedBefore: (rows.ApiToken ?? []).map(({ key, row }) => ({ key, hash: apiTokenProtectedHash(row) })),
      credentials: { managerEmail, workerEmail, password }, owned: {} };
  }, { isolationLevel: "Serializable", timeout: 60000 });
  return captureQuantityOwned(db, state);
}

function isOwned(table, row, state, known) {
  const { ids, marker } = state;
  const users = [ids.manager, ids.worker];
  if (identityTables.has(table)) return Object.values(ids).includes(row.id) &&
    (table !== "User" || users.includes(row.id));
  if (table === "Product") return row.projectId === ids.project && row.title?.includes(marker);
  if (table === "Work") return known.products.has(row.productId) && row.priceItemId === ids.price;
  if (table === "ProjectMaterial") return known.products.has(row.productId) && row.materialId === ids.material;
  if (table === "StockMovement") return row.materialId === ids.material && users.includes(row.createdById) &&
    (row.productId === null || known.products.has(row.productId));
  if (table === "Task") return row.projectId === ids.project && known.products.has(row.productId) && users.includes(row.createdById) && users.includes(row.assigneeId);
  if (table === "TaskAllocationGroup") return known.works.has(row.workId) && users.includes(row.createdById);
  if (table === "TaskDependency") return known.tasks.has(row.taskId) && known.tasks.has(row.dependsOnId);
  if (table === "TimeEntry") return known.tasks.has(row.taskId) && users.includes(row.userId);
  if (table === "PayrollEntry") return row.projectId === ids.project && users.includes(row.userId);
  if (table === "ProductStatusHistory") return known.products.has(row.productId) && users.includes(row.changedById);
  if (table === "ProjectStageHistory") return row.projectId === ids.project && users.includes(row.changedById);
  if (["ProductPercentageConfig", "ProductPercentageCompletion", "ProductStagePayPool", "ProductStageSettlement"].includes(table))
    return known.products.has(row.productId);
  if (table === "ProductPercentageParticipant") return known.configs.has(row.configId) && users.includes(row.userId);
  if (table === "ProductPercentageCompletionShare") return known.completions.has(row.completionId) && users.includes(row.userId);
  if (table === "ProductStageSettlementShare") return known.settlements.has(row.settlementId) && users.includes(row.userId);
  if (table === "WorkPaymentConversion") return known.works.has(row.workId);
  if (["UserPreference", "NotificationPreference"].includes(table)) return users.includes(row.userId);
  if (table === "ChangeLog") return users.includes(row.actorId);
  if (table === "DomainEvent") return users.includes(row.actor);
  if (table === "Notification") return users.includes(row.userId) || row.title?.includes(marker) ||
    [...known.products].some((id) => row.link === `/products/${id}`);
  return false;
}

export async function captureQuantityOwned(db, state) {
  assert.equal(state.format, "product-quantity-qa/v1");
  const tables = await quantityRows(db);
  const sets = (table, predicate) => new Set((tables[table] ?? []).filter(({ row }) => predicate(row)).map(({ row }) => row.id));
  const known = {
    products: sets("Product", (row) => row.projectId === state.ids.project && row.title.includes(state.marker)),
    works: sets("Work", (row) => row.projectId === state.ids.project),
    tasks: sets("Task", (row) => row.projectId === state.ids.project),
  };
  known.configs = sets("ProductPercentageConfig", (row) => known.products.has(row.productId));
  known.completions = sets("ProductPercentageCompletion", (row) => known.products.has(row.productId));
  known.settlements = sets("ProductStageSettlement", (row) => known.products.has(row.productId));
  const owned = {};
  for (const [table, rows] of Object.entries(tables)) {
    const baseline = new Map((state.before[table] ?? []).map((row) => [keyText(row.key), row.hash]));
    owned[table] = [];
    for (const entry of rows) {
      if (baseline.has(keyText(entry.key))) {
        if (table === "ApiToken" && entry.hash !== baseline.get(keyText(entry.key))) {
          const protectedBaseline = state.apiTokenProtectedBefore?.find((row) => keyText(row.key) === keyText(entry.key));
          assert.ok(protectedBaseline && apiTokenProtectedHash(entry.row) === protectedBaseline.hash, "API_TOKEN_PROTECTED_FIELD_CHANGED");
        } else assert.equal(entry.hash, baseline.get(keyText(entry.key)), `PREEXISTING_ROW_CHANGED_${table}`);
      }
      else {
        assert.ok(isOwned(table, entry.row, state, known), `UNOWNED_NEW_ROW_${table}`);
        owned[table].push({ key: entry.key, hash: entry.hash });
      }
    }
    assert.equal(rows.length - owned[table].length, baseline.size, `PREEXISTING_ROW_MISSING_${table}`);
  }
  assert.ok(known.products.size <= 2 && known.works.size <= 1 && known.tasks.size <= 3, "QA_CARD_WORK_TASK_LIMIT");
  assert.ok((owned.StockMovement?.length ?? 0) <= 3, "QA_MOVEMENT_LIMIT");
  const next = { ...state, owned };
  next.manifestSha256 = sha(JSON.stringify(owned));
  return next;
}

export async function cleanupQuantityOwned(db, state) {
  const captured = await captureQuantityOwned(db, state);
  const total = Object.values(captured.owned).reduce((sum, rows) => sum + rows.length, 0);
  await db.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
    await tx.$executeRawUnsafe(`LOCK TABLE ${cleanupOrder.map((table) => `"${table}"`).join(",")} IN SHARE ROW EXCLUSIVE MODE`);
    await tx.$executeRawUnsafe(`LOCK TABLE ${historyTriggers.map(([table]) => `"${table}"`).join(",")} IN ACCESS EXCLUSIVE MODE`);
    const locked = await captureQuantityOwned(tx, captured);
    assert.equal(locked.manifestSha256, captured.manifestSha256, "QA_MANIFEST_DRIFT");
    const triggerBefore = await triggerSignature(tx);
    // Уже существующий подход engineering QA: DDL локален транзакции,
    // конкурентные writers блокированы, определения не редактируются.
    for (const [table, name] of historyTriggers)
      await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${name}"`);
    for (const table of cleanupOrder) {
      for (const entry of captured.owned[table] ?? []) {
        // Идентичность + hash: никаких DELETE по префиксу или имени.
        const [current] = await tx.$queryRawUnsafe(`SELECT to_jsonb(t) AS row FROM "${table}" t WHERE to_jsonb(t) @> $1::jsonb FOR UPDATE`, JSON.stringify(entry.key));
        assert.ok(current && sha(JSON.stringify(current.row)) === entry.hash, `QA_COMPARE_AND_SET_${table}`);
        const result = await tx.$executeRawUnsafe(`DELETE FROM "${table}" t WHERE to_jsonb(t) @> $1::jsonb`, JSON.stringify(entry.key));
        assert.equal(result, 1, `QA_DELETE_COUNT_${table}`);
      }
    }
    for (const [table, name] of historyTriggers)
      await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${name}"`);
    assert.equal(await triggerSignature(tx), triggerBefore, "QA_TRIGGERS_NOT_RESTORED");
    const final = await captureQuantityOwned(tx, state);
    assert.equal(Object.values(final.owned).reduce((sum, rows) => sum + rows.length, 0), 0, "QA_PRESERVATION_FAILED");
  }, { isolationLevel: "Serializable", timeout: 60000 });
  return { status: "QA_CLEANED_PRESERVED", target: state.target, runId: state.runId, exactTables: Object.keys(state.before).length,
    triggersRestoredExactly: true, deleted: total };
}
