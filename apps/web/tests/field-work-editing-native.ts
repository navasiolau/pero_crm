import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { PrismaClient, type ProductStatus } from "@prisma/client";
import type { TaskTransaction } from "../src/server/tasks/transaction";
import type { DomainActor } from "../src/server/projects/core";

const runId = `qa120-${randomUUID()}`;
const ids = { worker: `${runId}-worker`, mounter: `${runId}-mounter`, combined: `${runId}-combined`, client: `${runId}-client`,
  project: `${runId}-project`, production: `${runId}-production`, storage: `${runId}-storage`, installation: `${runId}-installation`,
  firstPrice: `${runId}-price1`, nextPrice: `${runId}-price2` };
let db: PrismaClient | undefined, stage = "guard", rolledBack = false;
const checks: string[] = [];
class OwnedRollback extends Error {}
function expectRepeated(result:{ok:boolean;repeated?:boolean}) { assert.equal(result.ok,true); assert.equal(result.repeated,true); }

async function main() {
  loadEnvFile(".env.local");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1","localhost"].includes(url.hostname)); assert.equal(url.port, "5433"); assert.equal(url.pathname, "/pero_crm");
  url.hostname="127.0.0.1";
  const [container] = JSON.parse(execFileSync("docker", ["--context", "desktop-linux", "inspect", "pero_crm_pg"], { encoding: "utf8", windowsHide: true }));
  assert.equal(container.Id, "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5");
  assert.equal(container.State.Running, true);
  assert.ok(container.Mounts.some((mount: { Name?: string; Destination?: string }) => mount.Name === "pero_crm_v2_pgdata" && mount.Destination === "/var/lib/postgresql/data"));
  assert.deepEqual(container.HostConfig.PortBindings["5432/tcp"], [{ HostIp: "127.0.0.1", HostPort: "5433" }]);
  db = new PrismaClient({ datasourceUrl: url.href, log: [], errorFormat: "minimal" });
  const [identity] = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  assert.equal(identity.name, "pero_crm");
  const [{ addWorkCore }, { updateWorkCore }, { createOwnWorkTaskCore }, { listProductWorkOperations, listWorkPriceOptions }] = await Promise.all([
    import("../src/server/works/core"), import("../src/server/works/update-core"),
    import("../src/server/tasks/worker-allocation-core"), import("../src/server/works/queries"),
  ]);
  try {
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435,55001)`;
      const transaction: TaskTransaction = operation => operation(tx);
      const actors: DomainActor[] = [
        { id: ids.worker, name: "QA120 worker", roles: ["WORKER"], source: "web" },
        { id: ids.mounter, name: "QA120 mounter", roles: ["MOUNTER"], source: "web" },
        { id: ids.combined, name: "QA120 combined", roles: ["WORKER", "MOUNTER"], source: "web" },
      ];
      stage = "owned-fixtures";
      for (const actor of actors) await tx.user.create({ data: { id: actor.id, name: actor.name, email: `${actor.id}@example.invalid`,
        passwordHash: "QA120_LOGIN_DISABLED", roles: actor.roles, payScheme: "PIECE" } });
      await tx.client.create({ data: { id: ids.client, name: "QA120 owned", phone: "000" } });
      const number = 1_900_000_000 + randomInt(99_000_000);
      await tx.project.create({ data: { id: ids.project, number: String(number), numberInt: number, title: "QA120 owned", clientId: ids.client, currency: "BYN" } });
      for (const [index, productId, status] of [[1, ids.production, "PRODUCTION"], [2, ids.storage, "STORAGE"], [3, ids.installation, "INSTALLATION"]] as [number, string, ProductStatus][]) {
        await tx.product.create({ data: { id: productId, projectId: ids.project, number: `${number}.${index}`, suffixInt: index, title: "QA120 owned", status, quantity: 2 } });
      }
      await tx.priceItem.create({ data: { id: ids.firstPrice, name: "QA120 first", unit: "шт", price: "10.00" } });
      await tx.priceItem.create({ data: { id: ids.nextPrice, name: "QA120 next", unit: "м.п.", price: "20.00" } });

      stage = "worker-create-storage-and-replay";
      const create = { projectId: ids.project, productId: ids.storage, priceItemId: ids.firstPrice, quantityPerUnit: 5, clientMutationId: randomUUID() };
      const added = await addWorkCore(actors[0], create, transaction); assert.equal(added.ok, true); if (!added.ok) throw new Error("CREATE_REJECTED");
      const workId = added.workId;
      assert.deepEqual(await addWorkCore(actors[0], create, transaction), { ok: true, workId, repeated: true });
      assert.equal(await tx.work.count({ where: { productId: ids.storage } }), 1);
      checks.push(stage);

      stage = "status-matrix-and-strict-payload";
      for (const [actor, productId] of [[actors[0], ids.production], [actors[1], ids.installation], [actors[2], ids.production], [actors[2], ids.storage], [actors[2], ids.installation]] as [DomainActor, string][]) {
        assert.equal((await addWorkCore(actor, { ...create, productId, clientMutationId: randomUUID() }, transaction)).ok, true);
      }
      for (const [actor, productId] of [[actors[0], ids.installation], [actors[1], ids.production], [actors[1], ids.storage]] as [DomainActor, string][]) {
        assert.equal((await addWorkCore(actor, { ...create, productId, clientMutationId: randomUUID() }, transaction)).ok, false);
      }
      assert.equal((await addWorkCore(actors[0], { ...create, clientMutationId: randomUUID(), priceSnapshot: 1 }, transaction)).ok, false);
      assert.deepEqual(await listWorkPriceOptions({ id: ids.mounter, roles: ["MOUNTER"] }, ids.production, tx), []);
      checks.push(stage);

      stage = "change-price-before-tasks";
      let operations = await listProductWorkOperations(actors[0], ids.storage, tx);
      const priceChange = { projectId: ids.project, productId: ids.storage, workId, quantityPerUnit: 5,
        priceItemId: ids.nextPrice, expectedRevision: operations[workId].revision, clientMutationId: randomUUID() };
      assert.equal((await updateWorkCore(actors[0], priceChange, transaction)).ok, true);
      const repriced = await tx.work.findUniqueOrThrow({ where: { id: workId } });
      assert.equal(repriced.priceSnapshot?.toString(), "20"); assert.equal(repriced.unitSnapshot, "м.п."); assert.equal(repriced.quantity.toString(), "10");
      await tx.priceItem.update({ where: { id: ids.nextPrice }, data: { price: "99.00" } });
      assert.equal((await tx.work.findUniqueOrThrow({ where: { id: workId } })).priceSnapshot?.toString(), "20");
      checks.push(stage);

      stage = "self-take-six-and-immutable-facts";
      const self = { projectId: ids.project, productId: ids.storage, workId, title: "QA120 own task", type: "Производство",
        quantity: "6.00", dueAt: "2026-10-12", estimateMinutes: 30, dependencyIds: [], clientMutationId: randomUUID() };
      const taken = await createOwnWorkTaskCore(actors[0], self, transaction); assert.equal(taken.ok, true); if (!taken.ok) throw new Error("SELF_REJECTED");
      assert.equal(taken.assigneeId, ids.worker);
      expectRepeated(await createOwnWorkTaskCore(actors[0], self, transaction));
      assert.equal((await createOwnWorkTaskCore(actors[0], { ...self, clientMutationId: randomUUID(), assigneeId: ids.mounter }, transaction)).ok, false);
      await tx.task.update({ where: { id: taken.id }, data: { status: "DONE", doneAt: new Date("2026-09-30T09:00:00Z"), doneById: ids.worker } });
      await tx.timeEntry.create({ data: { taskId: taken.id, userId: ids.worker, source: "manual", minutes: 30, startedAt: new Date("2026-09-30T08:30:00Z"), stoppedAt: new Date("2026-09-30T09:00:00Z") } });
      await tx.payrollEntry.create({ data: { userId: ids.worker, taskId: taken.id, workId, productId: ids.storage,
        projectId: ids.project, amount: "120.00", bynAmount: "120.00", currency: "BYN", month: "2026-09", scheme: "PIECE" } });
      const snapshot = async () => JSON.stringify(await tx.task.findUniqueOrThrow({ where: { id: taken.id }, include: { timeEntries: true, payrollEntries: true } }));
      const before = await snapshot();
      operations = await listProductWorkOperations(actors[0], ids.storage, tx);
      assert.equal(operations[workId].allocated, "6.00"); assert.equal(operations[workId].remaining, "4.00"); assert.equal(operations[workId].canChangePrice, false);
      assert.equal("priceSnapshot" in operations[workId], false); assert.equal("tasks" in operations[workId], false);

      stage = "edit-twelve-floor-cas-replay";
      const edit = { projectId: ids.project, productId: ids.storage, workId, quantityPerUnit: 6, expectedRevision: operations[workId].revision, clientMutationId: randomUUID() };
      const updated = await updateWorkCore(actors[0], edit, transaction); assert.equal(updated.ok, true);
      expectRepeated(await updateWorkCore(actors[0], edit, transaction));
      operations = await listProductWorkOperations(actors[0], ids.storage, tx);
      assert.equal(operations[workId].allocated, "6.00"); assert.equal(operations[workId].remaining, "6.00");
      assert.equal((await tx.work.findUniqueOrThrow({ where: { id: workId } })).total?.toString(), "240");
      assert.equal((await updateWorkCore(actors[0], { ...edit, quantityPerUnit: 2.5, expectedRevision: operations[workId].revision, clientMutationId: randomUUID() }, transaction)).ok, false);
      assert.equal((await updateWorkCore(actors[0], { ...edit, priceItemId: ids.firstPrice, expectedRevision: operations[workId].revision, clientMutationId: randomUUID() }, transaction)).ok, false);
      assert.equal((await updateWorkCore(actors[0], { ...edit, clientMutationId: randomUUID() }, transaction)).ok, false);
      assert.equal((await updateWorkCore(actors[0], { ...edit, priceSnapshot: "0", clientMutationId: randomUUID() }, transaction)).ok, false);
      assert.equal(await snapshot(), before);
      checks.push(stage);

      stage = "last-quantity-and-special-work-refusal";
      const last = { ...self, quantity: "6.00", clientMutationId: randomUUID() };
      assert.equal((await createOwnWorkTaskCore(actors[0], last, transaction)).ok, true);
      assert.equal((await createOwnWorkTaskCore(actors[0], { ...last, quantity: "0.01", clientMutationId: randomUUID() }, transaction)).ok, false);
      expectRepeated(await createOwnWorkTaskCore(actors[0], last, transaction));
      assert.equal(await snapshot(), before);
      const special = await tx.work.findFirstOrThrow({ where: { productId: ids.storage, createdById: ids.combined } });
      await tx.work.update({ where: { id: special.id }, data: { paymentKind: "INSTALLATION" } });
      const refused = await updateWorkCore(actors[0], { ...edit, workId: special.id, clientMutationId: randomUUID() }, transaction);
      assert.equal(refused.ok, false); if (!refused.ok) assert.equal(refused.kind, "validation");
      assert.equal((await createOwnWorkTaskCore(actors[0], { ...last, workId: special.id, clientMutationId: randomUUID() }, transaction)).ok, false);
      checks.push(stage);
      stage = "outer-rollback";
      throw new OwnedRollback();
    }, { maxWait: 5_000, timeout: 60_000 });
  } catch (error) {
    if (!(error instanceof OwnedRollback)) throw error;
    rolledBack = true;
  }
  assert.equal(rolledBack, true);
  assert.equal(await db.user.count({ where: { id: { in: [ids.worker, ids.mounter, ids.combined] } } }), 0);
  assert.equal(await db.project.count({ where: { id: ids.project } }), 0);
  assert.equal(await db.priceItem.count({ where: { id: { in: [ids.firstPrice, ids.nextPrice] } } }), 0);
  console.log(JSON.stringify({ ok: true, database: "pero_crm", checks, outerRollback: true, ownRowsRemaining: 0 }));
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, stage, errorName: error?.name, errorCode: error?.code, checks, outerRollback: rolledBack }));
  process.exitCode = 1;
}).finally(async () => { await db?.$disconnect(); });
