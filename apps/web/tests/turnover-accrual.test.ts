import assert from "node:assert/strict";
import { test } from "node:test";
import { guardedModuleCache } from "./helpers/guarded-module-cache";

test("turnover adapter preserves confirmed ACK when each optional effect fails", async () => {
  for (const failed of ["dispatch", "person", "org", "cache"]) {
    let coreCalls = 0, reached = 0;
    const effects: string[] = [];
    const effect = (name: string) => { effects.push(name); if (name === failed) { reached++; throw Error("CONTROLLED_OPTIONAL_EFFECT"); } };
    const overrides = {
      "next/cache": { revalidatePath: () => effect("cache") },
      "../src/server/require-role": { requirePayrollManagement: async () => ({ user: { id: "accountant", name: "Accountant", roles: ["ACCOUNTANT"] } }) },
      "../src/server/payroll/turnover-core": { accrueTurnoverCore: async (actor: { id: string }, month: string, transaction: unknown) => {
        assert.equal(actor.id, "accountant"); assert.equal(month, "2026-01"); assert.equal(typeof transaction, "function");
        return { ok: true, accruedCount: coreCalls++ === 0 ? 1 : 0, currency: "BYN", total: 10000,
          earnings: coreCalls === 1 ? [{ eventId: "confirmed", userId: "employee", amount: 300, percent: 3, isTopUp: false }] : [] };
      } },
      "../src/server/plugins/events": { dispatchEvent: () => effect("dispatch") },
      "../src/server/notifications/notify": { notifyPerson: () => effect("person"), notifyOrg: () => effect("org") },
    };
    const fixture = guardedModuleCache(import.meta.url, { targets: ["../src/server/payroll/actions"], allowedOverrides: Object.keys(overrides), overrides, prisma: {} });
    await fixture.run(async () => {
      const { accrueTurnover } = fixture.load<typeof import("../src/server/payroll/actions")>("../src/server/payroll/actions");
      assert.deepEqual(await accrueTurnover("2026-01"), { ok: true, accruedCount: 1 });
      assert.ok(reached > 0, "FAULT_NOT_REACHED:" + failed);
      for (const name of ["dispatch", "person", "org"]) assert.equal(effects.filter(value => value === name).length, 1);
      assert.deepEqual(await accrueTurnover("2026-01"), { ok: true, accruedCount: 0 });
      assert.equal(coreCalls, 2);
      for (const name of ["dispatch", "person", "org"]) assert.equal(effects.filter(value => value === name).length, 1, "replay effect:" + name);
    });
  }
});
