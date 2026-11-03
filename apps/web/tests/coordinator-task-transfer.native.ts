import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, type Role } from "@prisma/client";
import { existingLocalCrmDatabaseUrl } from "./helpers/local-crm-database";
import { nativeSnapshot, verifiedRollback } from "./helpers/native-acceptance-snapshot";
import { changeTaskStatusCore } from "../src/server/tasks/completion-core";
import { transferPieceworkShareCore } from "../src/server/tasks/piecework-core";
import { listTaskReassignmentOptions, reassignOrdinaryTaskCore } from "../src/server/tasks/task-reassignment-core";
import type { TaskTransaction } from "../src/server/tasks/transaction";

// SAFETY-RULES.md: только существующая local5433, СТОП при любом guard mismatch.
async function main() {
  const expectedId = process.env.CRM_LOCAL_CONTAINER_ID;
  assert.match(expectedId ?? "", /^[a-f0-9]{64}$/, "LOCAL_CONTAINER_ID_REQUIRED");
  const [container] = JSON.parse(execFileSync("docker", ["inspect", "pero_crm_pg"], { encoding: "utf8", windowsHide: true }));
  assert.equal(container.Id, expectedId, "LOCAL_CONTAINER_ID_MISMATCH");
  assert.equal(container.Name, "/pero_crm_pg", "LOCAL_CONTAINER_NAME_MISMATCH");
  assert.equal(container.Config.Image, "postgres:16-alpine", "LOCAL_IMAGE_MISMATCH");
  assert.deepEqual(container.HostConfig.PortBindings["5432/tcp"], [{ HostIp: "127.0.0.1", HostPort: "5433" }], "LOCAL_PORT_MISMATCH");
  assert.ok(container.Mounts.some((mount: { Name: string; Destination: string }) => mount.Name === "pero_crm_v2_pgdata" && mount.Destination === "/var/lib/postgresql/data"), "LOCAL_VOLUME_MISMATCH");
  assert.ok(["running", "exited"].includes(container.State.Status), "LOCAL_STATE_UNEXPECTED");
  const started = container.State.Status === "exited";
  let db: PrismaClient | undefined;
  try {
    if (started) execFileSync("docker", ["start", expectedId!], { windowsHide: true, stdio: "ignore" });
    for (let attempt = 0; ; attempt++) {
      try { execFileSync("docker", ["exec", expectedId!, "pg_isready", "-U", "pero", "-d", "pero_crm"], { windowsHide: true, stdio: "ignore" }); break; }
      catch { if (attempt === 29) throw Error("LOCAL_POSTGRES_NOT_READY"); await new Promise(resolve => setTimeout(resolve, 1000)); }
    }
    db = new PrismaClient({ datasources: { db: { url: existingLocalCrmDatabaseUrl() } } });
    assert.deepEqual(await db.$queryRaw`SELECT current_database() AS name, current_schema() AS schema`, [{ name: "pero_crm", schema: "public" }], "LOCAL_DATABASE_MISMATCH");
    const system = await db.$queryRaw<{ id: string }[]>`SELECT system_identifier::text AS id FROM pg_control_system()`;
    assert.equal(system[0].id, "7663912963695341602", "LOCAL_SYSTEM_IDENTIFIER_MISMATCH");
    const before = await nativeSnapshot(db), rollback = new Error("TASK210_EXPECTED_ROLLBACK"), runId = randomUUID();
    let passed = false;
    await verifiedRollback(async () => {
      try {
        await db!.$transaction(async tx => {
          await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(18435, 55001)`;
          const worker = await tx.user.create({ data: { email: `qa210-old-${runId}@example.invalid`, name: "QA210 прежний исполнитель", passwordHash: "QA210-rollback-only", roles: ["WORKER"], payScheme: "PIECE" } });
          const recipient = await tx.user.create({ data: { email: `qa210-new-${runId}@example.invalid`, name: "QA210 новый исполнитель", passwordHash: "QA210-rollback-only", roles: ["WORKER"], payScheme: "PIECE" } });
          const owner = await tx.user.create({ data: { email: `qa210-coordinator-${runId}@example.invalid`, name: "QA210 ответственный", passwordHash: "QA210-rollback-only", roles: ["WORKER", "WORK_COORDINATOR"], payScheme: "PIECE" } });
          const actor = { id: owner.id, name: owner.name, roles: owner.roles, source: "web" as const };
          const receiver = { id: recipient.id, name: recipient.name, roles: recipient.roles as Role[], source: "web" as const };
          const client = await tx.client.create({ data: { name: `QA210 rollback ${runId}`, phone: `QA210-${runId}` } });
          const numberInt = 9_000_000 + Number.parseInt(runId.replaceAll("-", "").slice(0, 5), 16);
          assert.equal(await tx.project.count({ where: { number: String(numberInt) } }), 0, "OWNED_PROJECT_NUMBER_CONFLICT");
          const project = await tx.project.create({ data: { number: String(numberInt), numberInt, title: "QA210 откатываемая проверка", clientId: client.id, stage: "IN_WORK", currency: "BYN" } });
          const product = await tx.product.create({ data: { projectId: project.id, number: `${project.number}.1`, title: "QA210 изделие", status: "PRODUCTION" } });
          const work = await tx.work.create({ data: { projectId: project.id, productId: product.id, title: "QA210 работа", quantity: "30", priceSnapshot: "100", total: "3000", unitSnapshot: "шт." } });
          const doneAt = new Date("2026-10-15T12:00:00Z");
          const makeTask = (title: string) => tx.task.create({ data: { projectId: project.id, productId: product.id, workId: work.id, assigneeId: worker.id,
            title, type: "Производство", quantity: "10", status: "DONE", doneAt, doneById: worker.id, createdById: owner.id } });
          const fullTask = await makeTask("QA210 целиком"), partTask = await makeTask("QA210 доля"), withoutPayroll = await makeTask("QA210 без начисления");
          for (const task of [fullTask, partTask]) await tx.payrollEntry.create({ data: { userId: worker.id, taskId: task.id, workId: work.id, projectId: project.id,
            amount: "1000", bynAmount: "1000", currency: "BYN", scheme: "PIECE", month: "2026-10", comment: "QA210 исходный снимок" } });
          const cashAccount = await tx.cashAccount.create({ data: { name: `QA210 ${runId}`, currency: "BYN" } });
          await tx.payout.create({ data: { userId: worker.id, amount: "2000", bynAmount: "2000", payrollCurrency: "BYN", month: "2026-10", kind: "SALARY",
            cashAccountId: cashAccount.id, cashAmount: "2000", cashCurrency: "BYN", cashRate: "1", payrollRate: "1", cashRateDate: doneAt, payrollRateDate: doneAt } });
          const payouts = await tx.payout.findMany({ where: { userId: worker.id } });
          const transaction: TaskTransaction = operation => operation(tx);
          assert.ok((await listTaskReassignmentOptions(actor, fullTask.id, transaction)).ok);
          const fullInput = { taskId: fullTask.id, assigneeId: recipient.id, expectedRevision: 0, clientMutationId: randomUUID() };
          const moved = await reassignOrdinaryTaskCore(actor, fullInput, transaction); assert.ok(moved.ok, JSON.stringify(moved));
          const originalEntry = await tx.payrollEntry.findFirstOrThrow({ where: { taskId: fullTask.id } });
          assert.equal(originalEntry.userId, recipient.id); assert.equal(originalEntry.amount.toFixed(2), "1000.00"); assert.equal(originalEntry.month, "2026-10");
          const splitInput = { taskId: partTask.id, recipientId: recipient.id, percent: "40", expectedRevision: 0, clientMutationId: randomUUID() };
          const split = await transferPieceworkShareCore(actor, splitInput, transaction); assert.ok(split.ok, JSON.stringify(split));
          const child = await tx.task.findUniqueOrThrow({ where: { id: split.taskIds[1] } });
          assert.equal(child.status, "DONE"); assert.equal(child.doneAt!.toISOString(), doneAt.toISOString()); assert.equal(child.doneById, worker.id);
          const parts = await tx.payrollEntry.findMany({ where: { taskId: { in: split.taskIds } }, orderBy: { amount: "asc" } });
          assert.deepEqual(parts.map(row => [row.userId, row.amount.toFixed(2), row.month]), [[recipient.id, "400.00", "2026-10"], [worker.id, "600.00", "2026-10"]]);
          const entryCount = await tx.payrollEntry.count({ where: { workId: work.id } });
          const replay = await reassignOrdinaryTaskCore(actor, fullInput, transaction); assert.ok(replay.ok && replay.repeated);
          const splitReplay = await transferPieceworkShareCore(actor, splitInput, transaction); assert.ok(splitReplay.ok && splitReplay.repeated);
          assert.ok((await changeTaskStatusCore(receiver, child.id, "DONE", undefined, transaction)).ok);
          const noPayroll = await reassignOrdinaryTaskCore(actor, { ...fullInput, taskId: withoutPayroll.id, clientMutationId: randomUUID() }, transaction); assert.ok(noPayroll.ok);
          assert.equal(await tx.payrollEntry.count({ where: { taskId: withoutPayroll.id } }), 0);
          assert.equal(await tx.payrollEntry.count({ where: { workId: work.id } }), entryCount);
          assert.equal((await tx.payrollEntry.aggregate({ where: { workId: work.id }, _sum: { bynAmount: true } }))._sum.bynAmount!.toFixed(2), "2000.00");
          assert.deepEqual(await tx.payout.findMany({ where: { userId: worker.id } }), payouts);
          assert.equal((await reassignOrdinaryTaskCore(actor, { ...fullInput, clientMutationId: randomUUID(), assigneeId: owner.id }, transaction)).ok, false);
          passed = true; throw rollback;
        }, { maxWait: 5000, timeout: 30000 });
      } catch (error) { if (error !== rollback) throw error; }
      assert.equal(passed, true, "NATIVE_SCENARIOS_NOT_COMPLETED");
    }, async () => assert.deepEqual(await nativeSnapshot(db!), before, "LOCAL_DATA_OR_SCHEMA_CHANGED"));
    const output = path.resolve("../../.playwright-mcp/task-210"); mkdirSync(output, { recursive: true });
    const sources = ["src/server/tasks/task-payroll-transfer.ts", "src/server/tasks/task-reassignment-core.ts", "src/server/tasks/piecework-core.ts"];
    const report = { target: "local5433", containerId: expectedId, startedForCheck: started, runId, passed, preserved: true, tables: Object.keys(before.snapshot.rows).length,
      digest: before.digest, sourceHashes: Object.fromEntries(sources.map(file => [file, createHash("sha256").update(readFileSync(file)).digest("hex")])),
      cases: ["DONE full transfer", "DONE 40% transfer", "original month and amount", "salary payout unchanged", "exact replay", "no duplicate accrual", "no retroactive accrual", "stale revision"] };
    writeFileSync(path.join(output, "native.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally {
    await db?.$disconnect();
    if (started) {
      execFileSync("docker", ["stop", expectedId!], { windowsHide: true, stdio: "ignore" });
      assert.equal(execFileSync("docker", ["inspect", "--format", "{{.State.Status}}", expectedId!], { encoding: "utf8", windowsHide: true }).trim(), "exited", "LOCAL_INITIAL_STATE_NOT_RESTORED");
    }
  }
}

main().catch(error => {
  console.error(error instanceof assert.AssertionError ? error.message : error instanceof Error && error.name.startsWith("PrismaClient")
    ? error.message.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[redacted]") : error instanceof Error ? error.name : "NATIVE_FAILURE");
  process.exitCode = 1;
});
