import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { assertEngineeringQaTarget, assertEngineeringTriggerSet, assertFinalEngineeringScenario, cleanupEngineeringOwned, engineeringFingerprints, engineeringPublicPlan, ENGINEERING_TRIGGERS,
  engineeringTimestampInstant, prepareEngineeringOwned,
  validateEngineeringPlan, verifyEngineeringCapture } from "./engineering-owned-fixtures.mjs";

const target = { kind: "EXISTING_LOCAL", containerId: "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5", host: "127.0.0.1", port: 5433, database: "pero_crm" };

function plan() {
  const runId = randomUUID();
  const users = ["ENGINEER", "ENGINEER", "WORKER"].map((role, index) => ({ id: randomUUID(), name: `QA ${runId} ${index}`,
    email: `${runId}-${index}@qa.invalid`, roles: [role], active: true, payScheme: "PIECE", passwordHash: "$argon2id$unit-test-only" }));
  const tasks = ["2.00", "3.00"].map((quantity, index) => ({ id: randomUUID(), quantity, title: `QA ${runId} task ${index}`,
    status: index === 0 ? "DONE" : "NEW", assigneeId: users[0].id, dueAt: "2026-10-10T00:00:00Z", estimateMinutes: 60,
    ...(index === 0 ? { doneAt: "2026-09-28T00:00:00Z" } : {}) }));
  return { format: "pero-engineering-owned-qa/v1", runId, target, managerId: "existing-manager", users, baseline: engineeringFingerprints({}),
    newWorkTitle: `QA ${runId} new work`, newWorkQuantity: "10.30",
    project: { id: randomUUID(), number: `QA-ENG-${runId}`, numberInt: -1, title: `QA ${runId}`, clientId: "existing-client", currency: "BYN" },
    product: { id: randomUUID(), number: `QA-ENG-${runId}-1`, title: `QA ${runId} product`, expectedPrice: "10000.00", status: "DESIGN", engineerId: users[0].id },
    pool: { id: randomUUID() }, legacyWork: { id: randomUUID(), title: `QA ${runId} legacy`, quantity: "5.00", priceSnapshot: "100.00", total: "500.00" },
    legacyTasks: tasks, historicalTimeEntry: { id: randomUUID(), taskId: tasks[0].id, userId: users[0].id,
      startedAt: "2026-09-28T00:00:00Z", stoppedAt: "2026-09-28T01:00:00Z", minutes: 60 } };
}

test("target guard rejects production, altered local identity and absent target without DB", () => {
  assert.throws(() => assertEngineeringQaTarget(null), /TARGET_MISSING/);
  assert.throws(() => assertEngineeringQaTarget({ kind: "PRODUCTION", containerId: target.containerId }), /TARGET_FORBIDDEN/);
  assert.throws(() => assertEngineeringQaTarget({ ...target, database: "pero_crm_prod" }), /TARGET_FORBIDDEN/);
  assert.throws(() => assertEngineeringQaTarget({ ...target, containerId: "changed" }), /TARGET_FORBIDDEN/);
  assert.deepEqual(assertEngineeringQaTarget(target), target);
  const staging = { kind: "EXISTING_STAGING", containerId: "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a",
    guest: "crm-staging", host: "db", port: 5432, database: "crm" };
  assert.deepEqual(assertEngineeringQaTarget(staging), staging);
  assert.throws(() => assertEngineeringQaTarget({ ...staging, database: "pero_crm" }), /TARGET_FORBIDDEN/);
  assert.throws(() => assertEngineeringQaTarget({ ...staging, database: "crm_staging" }), /TARGET_FORBIDDEN/);
  assert.throws(() => assertEngineeringQaTarget({ ...staging, containerId: target.containerId }), /TARGET_FORBIDDEN/);
});

test("plan guard requires all explicit unique IDs and rejects malformed fixture context", () => {
  const valid = plan();
  assert.equal(validateEngineeringPlan(valid), valid);
  assert.throws(() => validateEngineeringPlan({ ...valid, product: { ...valid.product, id: undefined } }), /PLANNED_IDS_INVALID/);
  assert.throws(() => validateEngineeringPlan({ ...valid, users: valid.users.map((user) => ({ ...user, id: valid.project.id })) }), /PLANNED_IDS_INVALID/);
  assert.throws(() => validateEngineeringPlan({ ...valid, product: { ...valid.product, expectedPrice: "0.00" } }), /QA_PROJECT_INVALID/);
  assert.throws(() => validateEngineeringPlan({ ...valid, project: { ...valid.project, numberInt: -2147483649 } }), /QA_PROJECT_INVALID/);
});

function triggerRows() {
  return ENGINEERING_TRIGGERS.map(([table, name]) => {
    const functionName = table === "PayrollEntry" ? "protect_settled_product_payroll_entry" : "reject_product_payment_history_mutation";
    return { table_name: table, tgname: name, tgenabled: "O", tgisinternal: false,
      definition: `CREATE TRIGGER "${name}" BEFORE DELETE OR UPDATE ON public."${table}" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`,
      function_definition: `CREATE FUNCTION "${functionName}"() RETURNS trigger`, tgtype: 27, tgnargs: 0, tgqual: null,
      fnnamespace: "public", proname: functionName, prosecdef: false,
      prosrc: table === "PayrollEntry"
        ? `BEGIN IF OLD."settlementShareId" IS NOT NULL THEN RAISE EXCEPTION 'product engineering payroll entry is append-only'; END IF; IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END;`
        : `BEGIN RAISE EXCEPTION 'product payment history is append-only'; END;` };
  });
}

test("trigger guard rejects disabled, replaced and extra user triggers", () => {
  const rows = triggerRows();
  assert.equal(typeof assertEngineeringTriggerSet(rows), "string");
  assert.throws(() => assertEngineeringTriggerSet(rows.map((row, index) => index ? row : { ...row, tgenabled: "D" })), /TRIGGER_SET_MISMATCH/);
  assert.throws(() => assertEngineeringTriggerSet(rows.map((row, index) => index ? row : { ...row, definition: row.definition.replace("reject_product_payment_history_mutation", "other") })), /TRIGGER_SET_MISMATCH/);
  assert.throws(() => assertEngineeringTriggerSet(rows.map((row, index) => index ? row : { ...row, prosrc: "BEGIN RETURN NEW; END;" })), /TRIGGER_SET_MISMATCH/);
  assert.throws(() => assertEngineeringTriggerSet(rows.map((row, index) => index ? row : { ...row, tgqual: "WHEN (true)" })), /TRIGGER_SET_MISMATCH/);
  assert.throws(() => assertEngineeringTriggerSet(rows.map((row, index) => index ? row : { ...row, tgtype: 29 })), /TRIGGER_SET_MISMATCH/);
  assert.throws(() => assertEngineeringTriggerSet([...rows, { ...rows[0], tgname: "unknown" }]), /TRIGGER_SET_MISMATCH/);
});

function captureFixture() {
  const p = plan();
  const [e1, e2, worker] = p.users.map((user) => user.id);
  const newWorkId = randomUUID();
  const newTaskIds = [randomUUID(), randomUUID()];
  const groupId = randomUUID();
  const snapshot: Record<string, Record<string, unknown>[]> = {
    User: p.users.map((user) => ({ id: user.id, email: user.email, name: user.name, roles: user.roles, payScheme: user.payScheme,
      active: user.active, passwordHash: user.passwordHash })),
    Project: [{ id: p.project.id, clientId: p.project.clientId, currency: "BYN", number: p.project.number,
      numberInt: p.project.numberInt, title: p.project.title }],
    Product: [{ id: p.product.id, projectId: p.project.id, expectedPrice: "12000.00", status: "DESIGN",
      number: p.product.number, title: p.product.title }],
    ProductStagePayPool: [{ id: p.pool.id, productId: p.product.id }],
    Work: [{ id: p.legacyWork.id, productId: p.product.id, projectId: p.project.id, paymentKind: "ENGINEERING", stagePayPoolId: p.pool.id,
      poolWeightUnits: 400000, title: p.legacyWork.title, quantity: "5.00", priceSnapshot: "100.00", total: "500.00" },
      { id: newWorkId, productId: p.product.id, projectId: p.project.id, paymentKind: "ENGINEERING", stagePayPoolId: p.pool.id,
        poolWeightUnits: 600000, title: p.newWorkTitle, quantity: "10.30", createdById: p.managerId, priceSnapshot: null, total: null }],
    Task: [{ id: p.legacyTasks[0].id, projectId: p.project.id, productId: p.product.id, workId: p.legacyWork.id, assigneeId: e1,
      stageShareUnits: 800000, allocationGroupId: null, shareUnits: null, shareAmount: null, executorShare: "1.000",
      title: p.legacyTasks[0].title, quantity: "2.00", status: "DONE",
      doneAt: p.legacyTasks[0].doneAt, doneById: p.managerId },
    { id: p.legacyTasks[1].id, projectId: p.project.id, productId: p.product.id, workId: p.legacyWork.id, assigneeId: worker,
      stageShareUnits: 200000, allocationGroupId: null, shareUnits: null, shareAmount: null, executorShare: "1.000",
      title: p.legacyTasks[1].title, quantity: "3.00", status: "DONE" },
    { id: newTaskIds[0], projectId: p.project.id, productId: p.product.id, workId: newWorkId, assigneeId: e1,
      stageShareUnits: 500000, allocationGroupId: groupId, shareUnits: 500000, quantity: "10.30", shareAmount: null,
      status: "DONE", createdAt: "2026-09-28T00:00:00Z",
      title: p.newWorkTitle, createdById: p.managerId },
    { id: newTaskIds[1], projectId: p.project.id, productId: p.product.id, workId: newWorkId, assigneeId: e2,
      stageShareUnits: 500000, allocationGroupId: groupId, shareUnits: 500000, quantity: "10.30", shareAmount: null,
      status: "DONE", createdAt: "2026-09-28T01:00:00Z",
      title: p.newWorkTitle, createdById: e1 }],
    TaskAllocationGroup: [{ id: groupId, workId: newWorkId, quantity: "10.30", budgetSource: "STAGE_PREVIEW", budget: null, currency: null }],
    TaskDependency: [{ taskId: p.legacyTasks[1].id, dependsOnId: p.legacyTasks[0].id }],
    TimeEntry: [{ id: p.historicalTimeEntry.id, taskId: p.legacyTasks[0].id, userId: e1, minutes: 60, source: "manual", autoStopped: false,
      startedAt: p.historicalTimeEntry.startedAt, stoppedAt: p.historicalTimeEntry.stoppedAt }],
    WorkPaymentConversion: [{ id: randomUUID(), workId: p.legacyWork.id, poolId: p.pool.id }],
    ChangeLog: [{ id: `task-split:${randomUUID()}`, entity: "task", entityId: newTaskIds[0], action: "split",
      actorId: e1, actorType: "user", source: "web", newValue: { childTaskId: newTaskIds[1], recipientId: e2, groupId } }],
  };
  const manifest = engineeringPublicPlan(p);
  return { snapshot, manifest };
}

test("capture guard rejects unknown references and business fingerprint drift", () => {
  const { snapshot, manifest } = captureFixture();
  assert.equal(verifyEngineeringCapture(snapshot, manifest).settled, false);
  snapshot.File = [{ id: randomUUID(), projectId: manifest.ids.project }];
  assert.throws(() => verifyEngineeringCapture(snapshot, manifest), /UNKNOWN_REFERENCES/);
  delete snapshot.File;
  snapshot.Client = [{ id: "foreign-client", name: "changed" }];
  assert.throws(() => verifyEngineeringCapture(snapshot, manifest), /BUSINESS_FINGERPRINT_DRIFT/);
  delete snapshot.Client;
  snapshot.ChangeLog!.push({ id: `product-engineering-close:${randomUUID()}`, entity: "product", entityId: "foreign-product",
    actorId: "foreign", action: "engineering.close" });
  assert.throws(() => verifyEngineeringCapture(snapshot, manifest), /BUSINESS_FINGERPRINT_DRIFT/);
});

test("prepare and cleanup stop before touching a client without durable plan or drained actions", async () => {
  const p = plan();
  const db = new Proxy({}, { get: () => { throw new Error("DB_WAS_TOUCHED"); } });
  await assert.rejects(prepareEngineeringOwned({ db, plan: p, durablePlanSha256: "" }), /DURABLE_PLAN_PROOF_REQUIRED/);
  await assert.rejects(cleanupEngineeringOwned({ db, target, manifest: engineeringPublicPlan(p), captured: {}, actionsDrained: false }), /ACTIONS_NOT_DRAINED/);
});

test("ownership capture accepts initial and interrupted partial phases for exact cleanup", () => {
  const { snapshot, manifest } = captureFixture();
  const newWork = snapshot.Work.find((row) => row.id !== manifest.ids.legacyWork)!;
  snapshot.Work = snapshot.Work.filter((row) => row.id === manifest.ids.legacyWork);
  snapshot.Work[0].paymentKind = "LEGACY";
  snapshot.Work[0].stagePayPoolId = null;
  snapshot.Task = snapshot.Task.filter((row) => row.workId === manifest.ids.legacyWork);
  snapshot.Task[1].assigneeId = manifest.ids.users[0];
  snapshot.Task[0].stageShareUnits = null;
  snapshot.Task[1].stageShareUnits = null;
  snapshot.TaskAllocationGroup = [];
  snapshot.WorkPaymentConversion = [];
  snapshot.ChangeLog = [];
  snapshot.Product[0].expectedPrice = "10000.00";
  assert.equal(verifyEngineeringCapture(snapshot, manifest).phase, "INITIAL");
  snapshot.Work.push(newWork);
  snapshot.Task.push({ id: randomUUID(), projectId: manifest.ids.project, productId: manifest.ids.product, workId: newWork.id,
    assigneeId: manifest.ids.users[0], stageShareUnits: 1000000, allocationGroupId: "group", title: manifest.newWorkTitle,
    shareUnits: 1000000, quantity: "10.30", shareAmount: null, createdById: manifest.managerId });
  snapshot.TaskAllocationGroup = [{ id: "group", workId: newWork.id, quantity: "10.30", budgetSource: "STAGE_PREVIEW", budget: null, currency: null }];
  assert.equal(verifyEngineeringCapture(snapshot, manifest).phase, "WORK_CREATED");
});

test("captured graph hash changes when an owned row changes after capture", () => {
  const { snapshot, manifest } = captureFixture();
  const before = verifyEngineeringCapture(snapshot, manifest);
  snapshot.User![0].position = "changed after capture";
  const after = verifyEngineeringCapture(snapshot, manifest);
  assert.notEqual(after.graphHash, before.graphHash);
});

test("final scenario guard checks one BYN settlement and exact 372/180/48 allocation", () => {
  const { snapshot, manifest } = captureFixture();
  const [e1, e2, worker] = manifest.ids.users;
  const [legacyA, legacyB, newA, newB] = snapshot.Task!;
  const settlementId = randomUUID();
  snapshot.Product![0].status = "PRODUCTION";
  snapshot.ProductStagePayPool![0].state = "SETTLED";
  snapshot.ProductStageSettlement = [{ id: settlementId, poolId: manifest.ids.pool, productId: manifest.ids.product,
    projectId: manifest.ids.project, amount: "600.00", priceSnapshot: "12000.00", ratePercentSnapshot: "5.00",
    productCurrency: "BYN", payrollCurrency: "BYN" }];
  const allocations = [[legacyA, e1, "192.00"], [legacyB, worker, "48.00"], [newA, e1, "180.00"], [newB, e2, "180.00"]] as const;
  snapshot.ProductStageSettlementShare = allocations.map(([task, userId, amount]) => ({ id: randomUUID(), settlementId, taskId: task.id,
    workId: task.workId, userId, amount }));
  snapshot.PayrollEntry = allocations.map(([task, userId, amount], index) => ({ id: randomUUID(), productId: manifest.ids.product,
    projectId: manifest.ids.project, workId: task.workId, taskId: task.id, settlementShareId: snapshot.ProductStageSettlementShare![index].id,
    userId, amount, scheme: "PRODUCT_ENGINEERING", currency: "BYN", projectCurrency: "BYN" }));
  snapshot.Notification = [{ id: randomUUID(), userId: e1, type: "payroll.accrued", title: "Начислена зарплата: 372 BYN",
    body: `Инженерный фонд изделия ${manifest.product.number}`, link: "/payroll" },
  { id: randomUUID(), userId: "existing-accountant", type: "payroll.orgAccrued", title: `Начислено ${manifest.users[0].name}: 372 BYN`,
    body: `Инженерный фонд изделия ${manifest.product.number}`, link: "/finance/payroll" }];
  assert.equal(assertFinalEngineeringScenario(snapshot, manifest).phase, "SETTLED");
  snapshot.Notification.push({ id: randomUUID(), userId: "foreign", type: "payroll.orgAccrued", title: "Начислено чужому: 372 BYN",
    body: `Инженерный фонд изделия ${manifest.product.number}`, link: "/finance/payroll" });
  assert.throws(() => assertFinalEngineeringScenario(snapshot, manifest), /BUSINESS_FINGERPRINT_DRIFT/);
  snapshot.Notification.pop();
  snapshot.Product![0].status = "STORAGE";
  assert.equal(assertFinalEngineeringScenario(snapshot, manifest).phase, "SETTLED");
  snapshot.PayrollEntry![0].amount = "191.00";
  assert.throws(() => assertFinalEngineeringScenario(snapshot, manifest), /UNKNOWN_REFERENCES|SETTLEMENT_TOTAL_MISMATCH/);
});

test("foreign fingerprint uses exact jsonb text for large numeric values", () => {
  const first = { id: "business" } as Record<string, unknown>;
  const second = { id: "business" } as Record<string, unknown>;
  Object.defineProperty(first, "__raw", { value: '{"id":"business","amount":100000000000000001.00}' });
  Object.defineProperty(second, "__raw", { value: '{"id":"business","amount":100000000000000002.00}' });
  assert.notEqual(engineeringFingerprints({ PayrollEntry: [first] }).PayrollEntry,
    engineeringFingerprints({ PayrollEntry: [second] }).PayrollEntry);
});

test("PostgreSQL unzoned timestamp JSON is compared as UTC without changing exact instant", () => {
  const { snapshot, manifest } = captureFixture();
  const previous = process.env.TZ;
  process.env.TZ = "Europe/Moscow";
  try {
    snapshot.Task![0].doneAt = "2026-09-28T00:00:00";
    snapshot.TimeEntry![0].startedAt = "2026-09-28T00:00:00";
    snapshot.TimeEntry![0].stoppedAt = "2026-09-28T01:00:00";
    assert.doesNotThrow(() => verifyEngineeringCapture(snapshot, manifest));
    snapshot.Task![0].doneAt = "2026-09-28T00:00:01";
    assert.throws(() => verifyEngineeringCapture(snapshot, manifest), /LEGACY_TASK_CHANGED/);
    snapshot.Task![0].doneAt = "2026-09-28T03:00:00+03:00";
    assert.doesNotThrow(() => verifyEngineeringCapture(snapshot, manifest));
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("timestamp normalization preserves microseconds and explicit offsets", () => {
  assert.equal(engineeringTimestampInstant("2026-09-28T21:43:37.337"), engineeringTimestampInstant("2026-09-28T21:43:37.337Z"));
  assert.equal(engineeringTimestampInstant("2026-09-29T00:43:37.337+03:00"), engineeringTimestampInstant("2026-09-28T21:43:37.337Z"));
  assert.notEqual(engineeringTimestampInstant("2026-09-28T21:43:37.337001"), engineeringTimestampInstant("2026-09-28T21:43:37.337Z"));
  assert.equal(engineeringTimestampInstant("2026-02-30T00:00:00"), null);
});
