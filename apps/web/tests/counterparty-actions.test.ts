import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import type { Prisma, Role } from "@prisma/client";
import type { Session } from "next-auth";
import type { NextRequest } from "next/server";
import { authConfig } from "../src/auth.config";
import { guardedModuleCache } from "./helpers/guarded-module-cache";
import type { CounterpartyView } from "../src/server/counterparties/contracts";
Object.assign(globalThis, { React });

const allowed: Role[][] = [["ADMIN"], ["DIRECTOR"], ["MANAGER"], ["PROCUREMENT"], ["ENGINEER", "PROCUREMENT"]];
const denied: Role[][] = [["ENGINEER"], ["ACCOUNTANT"], ["WORKER"], ["MOUNTER"], ["WORK_COORDINATOR"], [], ["ENGINEER", "ACCOUNTANT"]];
const input = { type: "SUPPLIER" as const, company: "Компания" };
const initial: CounterpartyView = { id: "counterparty", ...input, phone: null, comment: null, revision: 0 };
function fixture(roles: Role[] | null) {
  let item = { ...initial }, writes = 0, reads = 0, failAudit = false;
  const logs: Prisma.ChangeLogCreateInput[] = [], refreshed: string[] = [];
  const db = {
    counterparty: {
      findMany: async () => { reads++; return [{ ...item }]; },
      findUnique: async () => { reads++; return { ...item }; },
      findUniqueOrThrow: async () => ({ ...item }),
      create: async ({ data }: { data: Omit<CounterpartyView, "id" | "revision"> }) => { writes++; item = { id: initial.id, revision: 0, ...data }; return { ...item }; },
      updateMany: async ({ where, data }: { where: { revision: number }; data: Omit<CounterpartyView, "id" | "revision"> & { revision: { increment: number } } }) => {
        if (where.revision !== item.revision) return { count: 0 }; writes++; item = { ...item, ...data, revision: item.revision + 1 }; return { count: 1 };
      },
    },
    changeLog: { create: async ({ data }: { data: Prisma.ChangeLogCreateInput }) => { if (failAudit) throw Error("QA174_AUDIT_FAILURE"); logs.push(data); return data; } },
    $queryRaw: async () => [{ locked: 1 }],
    $transaction: async <T>(operation: (tx: object) => Promise<T>) => {
      const before = { ...item }, beforeLogs = logs.length;
      try { return await operation(db); } catch (error) { item = before; logs.length = beforeLogs; throw error; }
    },
  };
  const overrides = {
    "../src/auth": { auth: async () => roles === null ? null : { user: { id: "actor", name: "Сотрудник", roles } } },
    "next/navigation": { redirect: (path: string) => { throw Error("REDIRECT " + path); } },
    "next/cache": { revalidatePath: (path: string) => refreshed.push(path) },
    "../src/app/(app)/counterparties/counterparties-view": { CounterpartiesView: () => null },
  };
  const scope = guardedModuleCache(import.meta.url, {
    targets: ["../src/server/counterparties/actions", "../src/server/counterparties/queries", "../src/app/(app)/counterparties/page"],
    overrides, allowedOverrides: Object.keys(overrides), prisma: db,
  });
  return { scope, stats: () => ({ reads, writes, item, logs, refreshed }), failAudit: () => { failAudit = true; } };
}

test("auth callback and real page/queries/actions reject forbidden roles before target access", async () => {
  for (const roles of [...denied, null]) {
    const authorization = authConfig.callbacks.authorized({ auth: roles === null ? null : { user: { id: "actor", roles, sessionVersion: 1 }, expires: "2099-01-01" } as Session,
      request: { nextUrl: new URL("https://crm.example.invalid/counterparties") } as NextRequest });
    assert.notEqual(authorization, true);
    const f = fixture(roles);
    await f.scope.run(async () => {
      const queries = f.scope.load<typeof import("../src/server/counterparties/queries")>("../src/server/counterparties/queries");
      const actions = f.scope.load<typeof import("../src/server/counterparties/actions")>("../src/server/counterparties/actions");
      const page = f.scope.load<typeof import("../src/app/(app)/counterparties/page")>("../src/app/(app)/counterparties/page");
      await assert.rejects(page.default(), /Недостаточно прав|REDIRECT/);
      await assert.rejects(actions.createCounterparty(input), /Недостаточно прав|REDIRECT/);
      await assert.rejects(actions.updateCounterparty(initial.id, input, 0), /Недостаточно прав|REDIRECT/);
      await assert.rejects(queries.listCounterparties({ roles: roles ?? [] }), /Недостаточно прав/);
      assert.equal(f.stats().reads, 0); assert.equal(f.stats().writes, 0);
    });
  }
});

test("real actions/page use permitted roles, return saved DTO and roll back when audit fails", async () => {
  for (const roles of allowed) {
    const f = fixture(roles);
    await f.scope.run(async () => {
      f.scope.load("../src/server/counterparties/queries");
      const actions = f.scope.load<typeof import("../src/server/counterparties/actions")>("../src/server/counterparties/actions");
      const page = f.scope.load<typeof import("../src/app/(app)/counterparties/page")>("../src/app/(app)/counterparties/page");
      const rendered = await page.default(); assert.deepEqual(rendered.props.rows, [initial]);
      const created = await actions.createCounterparty(input); assert.ok(created.ok); assert.deepEqual(created.item, initial);
      const saved = await actions.updateCounterparty(initial.id, { type: "CARRIER", company: "Перевозчик", phone: "200" }, 0);
      assert.ok(saved.ok); assert.equal(saved.item.revision, 1); assert.equal(saved.item.type, "CARRIER");
      assert.deepEqual(f.stats().refreshed, ["/counterparties", "/counterparties"]);
      f.failAudit(); const before = { ...f.stats().item }, failed = await actions.updateCounterparty(initial.id, { type: "CARRIER", company: "Не сохраняется" }, 1);
      assert.ok(!failed.ok && failed.kind === "failure"); assert.deepEqual(f.stats().item, before); assert.equal(f.stats().logs.length, 2);
    });
  }
});
