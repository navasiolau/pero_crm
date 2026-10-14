import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { guardedModuleCache } from "./helpers/guarded-module-cache";

test("BYN contract rejects foreign creation/update and payroll before database access", async () => {
  const actor = { id: "admin", name: "Admin", roles: ["ADMIN" as const], source: "web" as const };
  const noDb = new Proxy({}, { get() { throw Error("UNEXPECTED_DATABASE_ACCESS"); } }) as PrismaClient;
  const scope = guardedModuleCache(import.meta.url, {
    targets: ["../src/server/projects/core", "../src/server/payroll/actions"], prisma: noDb,
    allowedOverrides: ["../src/server/require-role", "next/cache"],
    overrides: { "../src/server/require-role": { requireAdmin: async () => ({ user: actor }) }, "next/cache": { revalidatePath() {} } },
  });
  try {
    const projects = scope.load<typeof import("../src/server/projects/core")>("../src/server/projects/core");
    const payroll = scope.load<typeof import("../src/server/payroll/actions")>("../src/server/payroll/actions");
    assert.equal(projects.createProjectSchema.parse({ title: "Заказ", clientId: "client" }).currency, "BYN");
    for (const currency of ["USD", "EUR", "RUB", "", "byn"]) {
      assert.equal(projects.createProjectSchema.safeParse({ title: "Заказ", clientId: "client", currency }).success, false);
      const result = await payroll.setPayrollCurrency(currency);
      assert.equal(result.ok, false); assert.match(result.error ?? "", /BYN/);
      const project = await projects.updateProjectCore(actor, "project", { currency, baseline: { currency: "BYN" } });
      assert.equal(project.ok, false); assert.match(project.error ?? "", /BYN/);
    }
  } finally { scope.restore(); }
});
