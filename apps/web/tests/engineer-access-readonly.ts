import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { existingLocalCrmDatabaseUrl } from "./helpers/local-crm-database";

/** Run explicitly against existing real local data; all queries share a READ ONLY transaction. */
async function main() {
  const db = new PrismaClient({ datasources: { db: { url: existingLocalCrmDatabaseUrl() } } });
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const [readOnly] = await tx.$queryRaw<{ transaction_read_only: string }[]>`SHOW transaction_read_only`;
      assert.equal(readOnly.transaction_read_only, "on");
      (globalThis as { prisma?: PrismaClient }).prisma = tx as unknown as PrismaClient;
      const products = await import("../src/server/products/queries");
      const projects = await import("../src/server/projects/queries");
      const [users, allProducts, allProjects, assignedTasks, fileCount] = await Promise.all([
        tx.user.findMany({ where: { active: true }, select: { id: true, roles: true } }),
        tx.product.findMany({ select: { id: true, number: true, projectId: true, engineerId: true, status: true, expectedPrice: true } }),
        tx.project.findMany({ select: { id: true } }),
        tx.task.findMany({ where: { assigneeId: { not: null } }, select: { projectId: true, assigneeId: true } }),
        tx.file.count(),
      ]);
      let pureEngineers = 0;
      let ownDesign = 0;
      let checkedDetails = 0;
      for (const actor of users) {
        const full = actor.roles.some((role) => ["ADMIN", "DIRECTOR", "MANAGER", "ACCOUNTANT"].includes(role));
        const field = actor.roles.some((role) => ["WORKER", "MOUNTER"].includes(role));
        const engineer = actor.roles.includes("ENGINEER");
        const ownTaskProjects = new Set(assignedTasks.filter((task) => task.assigneeId === actor.id).map((task) => task.projectId));
        const expected = allProducts.filter((product) => full || (engineer && product.engineerId === actor.id && product.status === "DESIGN") || (field && ownTaskProjects.has(product.projectId)));
        const expectedProjects = full ? new Set(allProjects.map((project) => project.id)) : new Set([
          ...expected.map((product) => product.projectId),
          ...(field ? ownTaskProjects : []),
        ]);
        const result = await products.listProducts(actor.id, actor.roles, { activeOnly: false });
        assert.deepEqual(new Set(result.rows.map((product) => product.id)), new Set(expected.map((product) => product.id)), "Product role cohort mismatch");
        const projectResult = await projects.listProjects(actor.id, actor.roles, { activeOnly: false });
        assert.deepEqual(new Set(projectResult.rows.map((project) => project.id)), expectedProjects, "Project role cohort mismatch");
        if (actor.roles.length !== 1 || !engineer) continue;
        pureEngineers += 1;
        ownDesign += expected.length;
        assert.equal((await products.listProducts(actor.id, actor.roles, { activeOnly: false, status: "PRODUCTION" })).total, 0);
        assert.equal((await products.listProducts(actor.id, actor.roles, { activeOnly: false, engineerId: "not-this-engineer" })).total, 0);
        const filterOptions = await products.listProductFilterOptions(actor.id, actor.roles);
        assert.deepEqual(new Set(filterOptions.projects.map((project) => project.id)), expectedProjects);
        for (const row of projectResult.rows) {
          const visible = expected.filter((product) => product.projectId === row.id);
          assert.equal(row._count.products, visible.length);
          assert.equal(row.totalPrice, visible.reduce((sum, product) => sum + Number(product.expectedPrice ?? 0), 0));
          for (const field of ["initialPrice", "delivery", "unloading", "installation"] as const) assert.equal(row[field], null);
        }
        for (const projectId of [...expectedProjects].slice(0, 3)) {
          const detail = await projects.getProjectFor(actor.id, actor.roles, projectId);
          assert.ok(detail);
          const allowed = new Set(expected.filter((product) => product.projectId === projectId).map((product) => product.id));
          assert.ok(detail.products.every((product) => allowed.has(product.id)));
          assert.ok(detail.tasks.every((task) => task.productId !== null && allowed.has(task.productId)));
          assert.ok(detail.files.every((file) => file.productId === null || allowed.has(file.productId)));
          checkedDetails += 1;
        }
        const hidden = allProducts.find((product) => !expected.some((visible) => visible.id === product.id));
        if (hidden) assert.equal(await products.getProductFor(actor.id, actor.roles, hidden.number), null);
        if (expected[0]) assert.ok(await products.getProductFor(actor.id, actor.roles, expected[0].number));
      }
      assert.ok(pureEngineers > 0, "No active pure-engineer cohort available");
      assert.ok(ownDesign > 0, "No real assigned DESIGN products available");
      console.log(JSON.stringify({ ok: true, transactionReadOnly: true, activeUsersChecked: users.length, projects: allProjects.length, products: allProducts.length, files: fileCount, pureEngineers, assignedDesignChecked: ownDesign, projectDetailsChecked: checkedDetails }));
    }, { isolationLevel: "RepeatableRead", timeout: 120_000 });
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Avoid printing a runtime DSN or full ORM error/context on failure.
  console.error(error instanceof assert.AssertionError ? error.message : "Read-only local CRM verification failed");
  process.exitCode = 1;
});
