import assert from "node:assert/strict";
import { PrismaClient, type ProductStatus, type Role } from "@prisma/client";
import { existingLocalCrmDatabaseUrl } from "./helpers/local-crm-database";
import {
  fileVisibilityWhere, productVisibilityWhere, resolveVisibilityActor,
  taskExecutionWhere, workVisibilityWhere,
} from "../src/server/access/visibility";

/** Один целевой сценарий на существующих данных; транзакция запрещает запись. */
async function main() {
  const db = new PrismaClient({ datasources: { db: { url: existingLocalCrmDatabaseUrl() } } });
  try {
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const [state] = await tx.$queryRaw<{ transaction_read_only: string }[]>`SHOW transaction_read_only`;
      assert.equal(state.transaction_read_only, "on");
      const user = await tx.user.findFirst({
        where: { active: true, roles: { hasSome: ["WORKER", "MOUNTER"] } },
        select: { id: true },
      });
      assert.ok(user, "An existing active field user is required");
      const all = await tx.product.findMany({
        where: { deletedAt: null, project: { deletedAt: null } },
        select: { id: true, status: true },
      });
      const hidden = all.find(row => row.status === "INSTALLATION");
      assert.ok(hidden, "An existing INSTALLATION product is required for the direct denial");
      const matrix: { roles: Role[]; statuses: ProductStatus[] }[] = [
        { roles: ["WORKER"], statuses: ["PRODUCTION", "STORAGE"] },
        { roles: ["MOUNTER"], statuses: ["INSTALLATION"] },
        { roles: ["WORKER", "MOUNTER"], statuses: ["PRODUCTION", "STORAGE", "INSTALLATION"] },
      ];
      const counts: number[] = [];
      for (const { roles, statuses } of matrix) {
        // The same existing identity invokes each policy cohort without editing User.roles.
        const actor = await resolveVisibilityActor(tx, { id: user.id, roles });
        const visible = await tx.product.findMany({ where: productVisibilityWhere(actor), select: { id: true } });
        assert.deepEqual(new Set(visible.map(row => row.id)), new Set(all.filter(row => statuses.includes(row.status)).map(row => row.id)), `${roles.join("+")} native product matrix`);
        assert.equal(await tx.task.count({ where: { AND: [taskExecutionWhere(actor), { product: { status: { notIn: statuses } } }] } }), 0, "Assigned task cannot bypass the matrix");
        assert.equal(await tx.work.count({ where: { AND: [workVisibilityWhere(actor), { product: { status: { notIn: statuses } } }] } }), 0, "Assigned work cannot bypass the matrix");
        assert.equal(await tx.file.count({ where: { AND: [fileVisibilityWhere(actor), { OR: [
          { product: { status: { notIn: statuses } } },
          { task: { product: { status: { notIn: statuses } } } },
        ] }] } }), 0, "Direct and task-linked files cannot bypass the matrix");
        counts.push(visible.length);
      }
      const worker = await resolveVisibilityActor(tx, { id: user.id, roles: ["WORKER"] });
      assert.equal(await tx.product.findFirst({ where: { AND: [{ id: hidden.id }, productVisibilityWhere(worker)] }, select: { id: true } }), null);
      console.log(JSON.stringify({ ok: true, transactionReadOnly: true, storedRolesUnchanged: true,
        policyProfilesChecked: 3, visibleCounts: counts, workerInstallationDenied: true }));
    }, { isolationLevel: "RepeatableRead", timeout: 60_000 });
  } finally {
    await db.$disconnect();
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof assert.AssertionError ? error.message : "Field visibility native verification failed");
  process.exitCode = 1;
});
