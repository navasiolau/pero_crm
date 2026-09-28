import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { canonicalEnvelope, cleanupOwned, deriveOwnership, envelopeSha256, executeOwnedQa, fingerprintOmittedColumns, LOCAL_CONTAINER_ID, openEnvelope, QaStop, REQUIRED_MIGRATION, sealEnvelope, SNAPSHOT_TABLES } from "./work-shares-owned-fixtures.mjs";

type Row = Record<string, unknown>;
type Rows = Record<string, Row[]>;
type Keys = Record<string, unknown[][]>;
const secret = "unit-test-only-signing-secret-with-at-least-32-characters";
const pk = (table: string, row: Row) => table === "TaskDependency" ? [row.taskId, row.dependsOnId]
  : table === "UserPreference" ? [row.userId, row.key] : [row.id];

function hashes(rows: Rows, excluded: Keys = {}) {
  return Object.fromEntries(SNAPSHOT_TABLES.map((table: string) => {
    const omit = new Set((excluded[table] ?? []).map((key) => JSON.stringify(key)));
    const kept = (rows[table] ?? []).filter((row) => !omit.has(JSON.stringify(pk(table, row))));
    const omittedColumns = new Set<string>(fingerprintOmittedColumns(table));
    const projected = kept.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !omittedColumns.has(key))));
    return [table, { count: kept.length, hash: createHash("sha256").update(JSON.stringify(projected)).digest("hex") }];
  }));
}

function fixture() {
  const runId = randomUUID();
  const foreign: Rows = { User: [{ id: "existing-person", roles: ["MANAGER"], active: true }], Project: [{ id: "existing-project", title: "preserve" }] };
  const manager = { id: "existing-person", roles: ["MANAGER"], sessionVersion: 0 };
  const users = ["WORKER", "MOUNTER"].map((role) => ({ id: randomUUID(), name: `LOCAL QA ${runId} ${role}`,
    email: `${runId}-${role.toLowerCase()}@qa.invalid`, passwordHash: "$argon2id$owned-unit-test-hash", roles: [role], active: true, payScheme: "PIECE", sessionVersion: 0 }));
  const project = { id: randomUUID(), number: `LOCAL-QA-${runId}`, numberInt: -2_000_000_000,
    title: `LOCAL QA ${runId}`, clientId: "existing-client", managerId: manager.id, createdById: manager.id,
    currency: "BYN", stage: "LEAD" };
  const work = { id: randomUUID(), title: `LOCAL QA ${runId} Work`, priceItemId: null };
  const source = { id: randomUUID(), title: `LOCAL QA ${runId} SourceA` };
  const dependent = { id: randomUUID(), title: `LOCAL QA ${runId} DependentB` };
  const plan = { version: 1, runId, target: { kind: "EXISTING_LOCAL" }, migration: REQUIRED_MIGRATION,
    users, project, work, source, dependent, manager, fractionalTitle: `LOCAL QA ${runId} FractionalC`,
    currency: "BYN", limits: { tasks: 4, groups: 1 }, baseline: hashes(foreign) };
  const task = (row: typeof source, index: number, workId: string | null) => ({ ...row,
    projectId: project.id, productId: null, workId, assigneeId: users[index].id, createdById: manager.id,
    status: "NEW", quantity: workId ? "10.00" : null, allocationGroupId: null, shareUnits: null, shareAmount: null });
  const records: Rows = {
    User: structuredClone(users), Project: [structuredClone(project)],
    Work: [{ ...work, projectId: project.id, productId: null, createdById: manager.id, quantity: "10.30", priceSnapshot: "100.00", total: "1030.00" }],
    Task: [task(source, 0, work.id), task(dependent, 1, null)],
    TaskDependency: [{ taskId: dependent.id, dependsOnId: source.id }],
  };
  return { plan, foreign, records };
}

function withSplit() {
  const value = fixture();
  const { plan, records } = value;
  const groupId = "app-generated-group";
  const childId = "app-generated-child";
  Object.assign(records.Task[0], { allocationGroupId: groupId, shareUnits: 700000, shareAmount: "700.00" });
  records.Task.push({ ...records.Task[0], id: childId, assigneeId: plan.users[1].id, createdById: plan.users[0].id, shareUnits: 300000, shareAmount: "300.00" });
  records.TaskAllocationGroup = [{ id: groupId, workId: plan.work.id, createdById: plan.users[0].id, quantity: "10.00", budget: "1000.00", currency: "BYN" }];
  records.TaskDependency.push({ taskId: plan.dependent.id, dependsOnId: childId });
  records.ChangeLog = [{ id: `task-split:${randomUUID()}`, actorId: plan.users[0].id, actorType: "user", source: "web", entity: "task", entityId: plan.source.id, action: "split",
    newValue: { recipientId: plan.users[1].id, percent: "30.00", expectedRevision: 0, childTaskId: childId, groupId } }];
  return value;
}

class MemoryAdapter {
  state: Rows;
  own: Rows;
  failAfterDelete = false;
  failInsertAfter = 0;
  migrationMissing = false;
  transactions = 0;
  inserted = 0;
  preparedRows: Rows = {};
  deletes: { table: string; keys: unknown[][] }[] = [];
  constructor(foreign: Rows, owned: Rows) {
    this.own = structuredClone(owned);
    this.state = Object.fromEntries(SNAPSHOT_TABLES.map((table: string) => [table, [...structuredClone(foreign[table] ?? []), ...structuredClone(owned[table] ?? [])]]));
  }
  async transaction(_mode: string, work: (tx: object) => Promise<unknown>) {
    this.transactions++;
    const draft = structuredClone(this.state);
    const own = structuredClone(this.own);
    let removed = false;
    const tx = {
      guard: async () => {
        if (this.migrationMissing) throw new QaStop("REQUIRED_MIGRATION_NOT_APPLIED");
        return { schemaHash: "unit-schema", currency: "BYN" };
      },
      candidates: async () => structuredClone(own),
      insertPlan: async () => {
        for (const [table, rows] of Object.entries(this.preparedRows)) for (const row of rows) {
          draft[table].push(structuredClone(row));
          (own[table] ??= []).push(structuredClone(row));
          this.inserted++;
          if (this.inserted === this.failInsertAfter) throw new QaStop("INJECTED_INSERT_FAILURE");
        }
      },
      fingerprints: async (keys: Keys) => removed && this.failAfterDelete ? { drift: true } : hashes(draft, keys),
      deleteExact: async (table: string, keys: unknown[][]) => {
        removed = true;
        this.deletes.push({ table, keys });
        const wanted = new Set(keys.map((key) => JSON.stringify(key)));
        const before = draft[table].length;
        draft[table] = draft[table].filter((row) => !wanted.has(JSON.stringify(pk(table, row))));
        own[table] = (own[table] ?? []).filter((row) => !wanted.has(JSON.stringify(pk(table, row))));
        return before - draft[table].length;
      },
    };
    const result = await work(tx);
    this.state = draft; // только успешный callback фиксирует изменения
    this.own = own;
    return result;
  }
}

test("HMAC refuses a tampered foreign ID and canonical bytes survive key ordering", () => {
  const { plan } = fixture();
  const envelope = sealEnvelope({ plan, phase: "PLANNED" }, secret);
  const reordered = { hmac: envelope.hmac, body: envelope.body, format: envelope.format };
  assert.equal(envelopeSha256(reordered), envelopeSha256(envelope));
  assert.ok(canonicalEnvelope(envelope).endsWith("\n"));
  openEnvelope(reordered, secret);
  envelope.body.plan.source.id = randomUUID();
  assert.throws(() => openEnvelope(envelope, secret), /MANIFEST_TAMPERED/);
});

test("a project-link notification with an unproven actor/body is not adopted", () => {
  const { plan, records } = fixture();
  records.Notification = [{ id: "unproven-note", userId: "existing-person", type: "task.statusChanged",
    title: `Задача «${plan.source.title}»: выполнена`, body: `Проект ${plan.project.number} · Unrelated actor`, link: `/projects/${plan.project.id}` }];
  assert.throws(() => deriveOwnership(plan, records), /AMBIGUOUS_NOTIFICATION_REJECTED/);
});

function localContext(adapter: MemoryAdapter) {
  return { adapter, env: { CRM_LOCAL_CONTAINER_ID: LOCAL_CONTAINER_ID, AUTH_SECRET: secret },
    localContainer: { Id: LOCAL_CONTAINER_ID, Name: "/pero_crm_pg", State: { Running: true },
      HostConfig: { PortBindings: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "5433" }] } },
      Mounts: [{ Type: "volume", Name: "pero_crm_v2_pgdata", Destination: "/var/lib/postgresql/data" }],
      Config: { Env: ["POSTGRES_DB=pero_crm", "POSTGRES_USER=pero", "POSTGRES_PASSWORD=unit-test-only"] } } };
}
function transportFixture(present = false) {
  const f = fixture();
  f.plan.target = { kind: "EXISTING_LOCAL", database: "pero_crm", username: "pero", container: LOCAL_CONTAINER_ID, volume: "pero_crm_v2_pgdata" } as typeof f.plan.target;
  const adapter = new MemoryAdapter(f.foreign, present ? f.records : {});
  adapter.preparedRows = f.records;
  const envelope = sealEnvelope({ plan: f.plan, phase: "PLANNED" }, secret);
  return { ...f, adapter, envelope, options: localContext(adapter) };
}

test("prepare cannot open a write transaction without root durable readback digest", async () => {
  const f = transportFixture();
  const result = await executeOwnedQa({ target: "local", operation: "prepare", envelope: f.envelope }, f.options);
  assert.equal(result.publicSummary.code, "DURABLE_PLAN_READBACK_REQUIRED");
  assert.equal(f.adapter.transactions, 0);
});

test("partial initial create rolls back all six entities and their edge", async () => {
  const f = transportFixture();
  const before = structuredClone(f.adapter.state);
  f.adapter.failInsertAfter = 3;
  const result = await executeOwnedQa({ target: "local", operation: "prepare", envelope: f.envelope, durablePlanSha256: envelopeSha256(f.envelope) }, f.options);
  assert.equal(result.publicSummary.status, "STOP");
  assert.equal(result.publicSummary.code, "INJECTED_INSERT_FAILURE");
  assert.equal(f.adapter.inserted, 3);
  assert.deepEqual(f.adapter.state, before);
});

test("inspect recovers a lost prepare response by planned IDs without reinserting", async () => {
  const f = transportFixture(true);
  const result = await executeOwnedQa({ target: "local", operation: "inspect", envelope: f.envelope }, f.options);
  assert.equal(result.publicSummary.phase, "PREPARED");
  assert.equal(f.adapter.inserted, 0);
  const repeated = await executeOwnedQa({ target: "local", operation: "prepare", envelope: f.envelope, durablePlanSha256: envelopeSha256(f.envelope) }, f.options);
  assert.equal(repeated.publicSummary.code, "PREPARE_ALREADY_PRESENT_USE_INSPECT");
  assert.equal(f.adapter.inserted, 0);
});

test("missing migration stops prepare before inserts; helper never applies schema", async () => {
  const f = transportFixture();
  f.adapter.migrationMissing = true;
  const result = await executeOwnedQa({ target: "local", operation: "prepare", envelope: f.envelope, durablePlanSha256: envelopeSha256(f.envelope) }, f.options);
  assert.equal(result.publicSummary.code, "REQUIRED_MIGRATION_NOT_APPLIED");
  assert.equal(f.adapter.inserted, 0);
});

test("production and a stage AUTH_SECRET override are rejected before adapter use", async () => {
  const f = transportFixture();
  const production = await executeOwnedQa({ target: "production", operation: "plan" }, f.options);
  assert.equal(production.publicSummary.code, "TARGET_FORBIDDEN");
  const staging = await executeOwnedQa({ target: "staging", operation: "plan" }, { ...f.options, authSecret: "must-not-override-stage" });
  assert.equal(staging.publicSummary.code, "STAGING_SECRET_OVERRIDE_FORBIDDEN");
  assert.equal(f.adapter.transactions, 0);
});

test("a task pointing at a foreign project is refused before any delete", async () => {
  const { plan, foreign, records } = fixture();
  records.Task[0].projectId = "existing-project";
  const adapter = new MemoryAdapter(foreign, records);
  await assert.rejects(cleanupOwned(adapter, { plan, phase: "CAPTURED" }, { actionsDrained: true }), /FOREIGN_TASK_REJECTED/);
  assert.equal(adapter.deletes.length, 0);
});

test("five tasks are never adopted as the approved four-task fixture", () => {
  const { plan, records } = fixture();
  records.Task.push(...["extra-1", "extra-2", "extra-3"].map((id) => ({ ...records.Task[0], id })));
  assert.throws(() => deriveOwnership(plan, records), /MAX_FOUR_TASKS/);
});

test("child and group cannot be adopted without the matching split receipt", () => {
  const { plan, records } = withSplit();
  records.ChangeLog[0].actorId = "existing-person";
  assert.throws(() => deriveOwnership(plan, records), /SPLIT_RECEIPT_ACTOR_INVALID/);
  records.ChangeLog[0].actorId = plan.users[0].id;
  records.ChangeLog[0].newValue = { ...(records.ChangeLog[0].newValue as Row), childTaskId: "foreign-child" };
  assert.throws(() => deriveOwnership(plan, records), /SPLIT_RECEIPT_BINDING_INVALID/);
});

test("changed QA user role or name stops cleanup instead of overwriting", () => {
  for (const change of [{ roles: ["ADMIN"] }, { name: "Somebody else" }]) {
    const { plan, records } = fixture();
    Object.assign(records.User[0], change);
    assert.throws(() => deriveOwnership(plan, records), /QA_USER_IDENTITY_CHANGED/);
  }
});

test("foreign drift such as an unexpected payment prevents all deletes", async () => {
  const { plan, foreign, records } = fixture();
  const ownership = deriveOwnership(plan, records);
  const adapter = new MemoryAdapter({ ...foreign, Payment: [{ id: "unexpected-payment", projectId: plan.project.id }] }, records);
  await assert.rejects(cleanupOwned(adapter, { plan, phase: "CAPTURED", ownership }, { actionsDrained: true }), /FOREIGN_ROWS_CHANGED/);
  assert.equal(adapter.deletes.length, 0);
});

function withExistingToken() {
  const f = fixture();
  f.foreign.ApiToken = [{ id: "existing-api-token", name: "Existing API integration", tokenHash: "unit-test-only-token-hash",
    prefix: "test-prefix", scopes: ["read"], pluginId: null, createdById: "existing-person", createdAt: "2026-09-01T00:00:00.000Z",
    revokedAt: null, lastUsedAt: null, futureSecurityField: "preserve-unknown-fields" }];
  f.plan.baseline = hashes(f.foreign);
  return f;
}

test("ApiToken usage-date drift allows exact owned cleanup without resetting the token", async () => {
  for (const before of [null, "2026-09-28T10:00:00.000Z"]) {
    const { plan, foreign, records } = withExistingToken();
    foreign.ApiToken[0].lastUsedAt = before;
    plan.baseline = hashes(foreign);
    const ownership = deriveOwnership(plan, records);
    const adapter = new MemoryAdapter(foreign, records);
    adapter.state.ApiToken[0].lastUsedAt = "2026-09-28T12:00:00.000Z";
    const expectedTokens = structuredClone(adapter.state.ApiToken);
    const result = await cleanupOwned(adapter, { plan, phase: "CAPTURED", ownership }, { actionsDrained: true });
    assert.equal(result.phase, "CLEANED");
    assert.deepEqual(adapter.state.ApiToken, expectedTokens);
    assert.ok(adapter.deletes.every((entry) => entry.table !== "ApiToken"));
    assert.equal(hashes(adapter.state).ApiToken.count, 1);
    assert.deepEqual(hashes(adapter.state), plan.baseline);
  }
});

test("ApiToken scopes, hash, revocation and every other field remain protected despite usage drift", async () => {
  const changes = [
    { scopes: ["read", "write"] }, { tokenHash: "changed-hash" }, { revokedAt: "2026-09-28T12:00:00.000Z" },
    { id: "replacement-token" }, { name: "Changed integration" }, { prefix: "changed-prefix" },
    { pluginId: "another-plugin" }, { createdById: "another-person" }, { createdAt: "2026-09-02T00:00:00.000Z" },
    { futureSecurityField: "changed" },
  ];
  for (const change of changes) {
    const { plan, foreign, records } = withExistingToken();
    const ownership = deriveOwnership(plan, records);
    const adapter = new MemoryAdapter(foreign, records);
    Object.assign(adapter.state.ApiToken[0], change, { lastUsedAt: "2026-09-28T12:00:00.000Z" });
    const before = structuredClone(adapter.state);
    await assert.rejects(cleanupOwned(adapter, { plan, phase: "CAPTURED", ownership }, { actionsDrained: true }), /FOREIGN_ROWS_CHANGED/);
    assert.equal(adapter.deletes.length, 0);
    assert.deepEqual(adapter.state, before);
  }
});

test("ApiToken row insertion and removal remain foreign drift", async () => {
  for (const mode of ["insert", "remove"]) {
    const { plan, foreign, records } = withExistingToken();
    const ownership = deriveOwnership(plan, records);
    const adapter = new MemoryAdapter(foreign, records);
    if (mode === "insert") adapter.state.ApiToken.push({ ...adapter.state.ApiToken[0], id: "new-token" });
    else adapter.state.ApiToken = [];
    const before = structuredClone(adapter.state);
    await assert.rejects(cleanupOwned(adapter, { plan, phase: "CAPTURED", ownership }, { actionsDrained: true }), /FOREIGN_ROWS_CHANGED/);
    assert.equal(adapter.deletes.length, 0);
    assert.deepEqual(adapter.state, before);
  }
});

test("usage-date exception applies only to ApiToken, not similarly named fields elsewhere", () => {
  const before: Rows = { TimeEntry: [{ id: "existing-timer", lastUsedAt: null }] };
  const after = structuredClone(before);
  after.TimeEntry[0].lastUsedAt = "2026-09-28T12:00:00.000Z";
  assert.notDeepEqual(hashes(after), hashes(before));
});

test("wrong amount in a proven own payroll row is an application failure, not foreign ownership", async () => {
  const { plan, foreign, records } = withSplit();
  records.Task[0].status = "DONE";
  records.PayrollEntry = [{ id: "own-wrong-payroll", userId: plan.users[0].id, taskId: plan.source.id, workId: plan.work.id, projectId: plan.project.id, scheme: "PIECE", currency: "BYN", amount: "699.00" }];
  const ownership = deriveOwnership(plan, records);
  assert.ok(ownership.diagnostics.includes("PAYROLL_VALUE_MISMATCH"));
  const adapter = new MemoryAdapter(foreign, records);
  await cleanupOwned(adapter, { plan, phase: "CAPTURED", ownership }, { actionsDrained: true });
  assert.deepEqual(hashes(adapter.state), plan.baseline);
  assert.ok(adapter.deletes.find((entry) => entry.table === "PayrollEntry")?.keys.some((key) => key[0] === "own-wrong-payroll"));
});

test("successful cleanup deletes exact approved keys and preserves existing rows", async () => {
  const { plan, foreign, records } = fixture();
  const ownership = deriveOwnership(plan, records);
  const adapter = new MemoryAdapter(foreign, records);
  await cleanupOwned(adapter, { plan, phase: "CAPTURED", ownership }, { actionsDrained: true });
  assert.deepEqual(adapter.state.User, foreign.User);
  assert.deepEqual(adapter.state.Project, foreign.Project);
  assert.ok(adapter.deletes.every((entry) => entry.keys.every((key) => !key.includes("existing-person") && !key.includes("existing-project"))));
});

test("post-delete mismatch rolls back the whole cleanup transaction", async () => {
  const { plan, foreign, records } = fixture();
  const ownership = deriveOwnership(plan, records);
  const adapter = new MemoryAdapter(foreign, records);
  const before = structuredClone(adapter.state);
  adapter.failAfterDelete = true;
  await assert.rejects(cleanupOwned(adapter, { plan, phase: "CAPTURED", ownership }, { actionsDrained: true }), /CLEANUP_POSTCHECK_FAILED/);
  assert.ok(adapter.deletes.length > 0);
  assert.deepEqual(adapter.state, before);
});

test("cleanup refuses an un-drained browser before opening a transaction", async () => {
  let started = false;
  const adapter = { transaction: async () => { started = true; } };
  await assert.rejects(cleanupOwned(adapter, {}), /BROWSER_ACTIONS_NOT_DRAINED/);
  assert.equal(started, false);
});

test("fractional C requires the planned name, manager creator and a matching create receipt", () => {
  const { plan, records } = fixture();
  records.Task.push({ ...records.Task[0], id: "app-fractional", title: plan.fractionalTitle, quantity: "0.30" });
  assert.throws(() => deriveOwnership(plan, records), /FRACTIONAL_CREATE_RECEIPT_MISSING/);
  records.ChangeLog = [{ id: "create-fractional", entity: "task", entityId: "app-fractional", actorId: plan.manager.id,
    actorType: "user", source: "web", action: "create", newValue: { title: plan.fractionalTitle, project: plan.project.number } }];
  assert.equal(deriveOwnership(plan, records).tasks.fractional, "app-fractional");
  records.Task[2].createdById = plan.users[1].id;
  assert.throws(() => deriveOwnership(plan, records), /FRACTIONAL_IDENTITY_CHANGED/);
});

test("a lost cleanup response is resolved from absent planned IDs and exact baseline without deletes", async () => {
  const f = transportFixture();
  const ownership = deriveOwnership(f.plan, f.records);
  const envelope = sealEnvelope({ plan: f.plan, phase: "CAPTURED", ownership }, secret);
  const result = await executeOwnedQa({ target: "local", operation: "cleanup", envelope,
    durableCheckpointSha256: envelopeSha256(envelope), actionsDrained: true }, f.options);
  assert.equal(result.publicSummary.phase, "CLEANED");
  assert.equal(f.adapter.deletes.length, 0);
  assert.deepEqual(hashes(f.adapter.state), f.plan.baseline);
});

test("staging rejects another schema, duplicate URL options, fragments and non-Postgres protocols before adapter access", async () => {
  const cases = [
    "postgresql://db/crm?schema=other",
    "postgresql://db/crm?schema=public&schema=public",
    "postgresql://db/crm?connection_limit=1&connection_limit=2",
    "postgresql://db/crm#fragment",
    "https://db/crm",
  ];
  for (const value of cases) {
    const url = new URL(value);
    url.username = "crm";
    url.password = "unit-test-only";
    let reached = false;
    const adapter = { transaction: async () => { reached = true; throw new QaStop("ADAPTER_REACHED"); } };
    const result = await executeOwnedQa({ target: "staging", operation: "plan" }, { adapter,
      env: { S3_BUCKET: "pero-crm-staging", DATABASE_URL: url.href, AUTH_SECRET: secret } });
    assert.equal(result.publicSummary.status, "STOP");
    assert.equal(reached, false, value);
  }
});

test("staging accepts only absent or explicit public schema at the environment boundary", async () => {
  for (const query of ["", "?schema=public"]) {
    const url = new URL(`postgresql://db/crm${query}`);
    url.username = "crm";
    url.password = "unit-test-only";
    let reached = false;
    const adapter = { transaction: async () => { reached = true; throw new QaStop("ADAPTER_REACHED"); } };
    const result = await executeOwnedQa({ target: "staging", operation: "plan" }, { adapter,
      env: { S3_BUCKET: "pero-crm-staging", DATABASE_URL: url.href, AUTH_SECRET: secret } });
    assert.equal(result.publicSummary.code, "ADAPTER_REACHED");
    assert.equal(reached, true);
  }
});
