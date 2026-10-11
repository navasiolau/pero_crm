import assert from "node:assert/strict";
import { createRequire, Module } from "node:module";
import { test } from "node:test";
import type { Role } from "@prisma/client";
import { NextRequest } from "next/server";
import { navItemsForRole } from "../src/lib/nav";
import { authConfig } from "../src/auth.config";

const denied: Role[][] = [["DIRECTOR"], ["PROCUREMENT"], ["ACCOUNTANT"], ["MANAGER"], ["ENGINEER"], ["WORKER"], ["MOUNTER"], ["MANAGER", "ENGINEER"], ["ACCOUNTANT", "PROCUREMENT"], []];
test("global Journal navigation and actual route callback grant ADMIN only", () => {
  for (const roles of [["ADMIN"] as Role[], ...denied]) {
    const allowed = roles.includes("ADMIN");
    assert.equal(navItemsForRole(roles).some(item => item.href === "/changelog"), allowed, `navigation ${roles}`);
    for (const path of ["/changelog", "/changelog/", "/changelog/export"]) {
      const result = authConfig.callbacks.authorized({ auth: { user: { id: "actor", roles, sessionVersion: 0 }, expires: "2099-01-01" }, request: new NextRequest(`http://example.invalid${path}`) });
      assert.equal(result === true, allowed, `route ${roles} ${path}`);
    }
  }
});

test("real global Journal query and page reject non-admin before reading audit rows", async () => {
  const require = createRequire(import.meta.url);
  const inject = (specifier: string, exports: Record<string, unknown>) => {
    const filename = require.resolve(specifier), stubModule = new Module(filename);
    stubModule.filename = filename; stubModule.loaded = true; stubModule.exports = exports; require.cache[filename] = stubModule;
  };
  let roles: Role[] = ["ADMIN"], reads = 0;
  let lastInput: unknown;
  inject("../src/auth", { auth: async () => ({ user: { id: "actor", roles } }) });
  inject("../src/lib/prisma", { prisma: { changeLog: { findMany: async (input: unknown) => { reads++; lastInput = input; return []; } } } });
  const { listGlobalChangeLog } = require("../src/server/changelog/queries") as typeof import("../src/server/changelog/queries");
  const { default: page } = require("../src/app/(app)/changelog/page") as typeof import("../src/app/(app)/changelog/page");
  for (const combination of denied) {
    roles = combination;
    await assert.rejects(() => listGlobalChangeLog({ actor: "secret", entity: "payment" }), /Недостаточно прав/);
    await assert.rejects(() => page({ searchParams: Promise.resolve({}) }), /Недостаточно прав/);
  }
  assert.equal(reads, 0);
  roles = ["ADMIN"];
  assert.deepEqual(await listGlobalChangeLog({ actor: "Ivan", entity: "task", from: "2026-10-01", to: "2026-10-03" }), []);
  assert.equal(reads, 1);
  assert.deepEqual(lastInput, { where: { NOT: { entity: "task", action: "task.status.request", id: { startsWith: "task-status:" } }, OR: [{ actorName: { contains: "Ivan", mode: "insensitive" } }, { actorId: { contains: "Ivan", mode: "insensitive" } }], entity: { contains: "task", mode: "insensitive" }, createdAt: { gte: new Date("2026-10-01"), lte: new Date("2026-10-03T23:59:59") } }, orderBy: { createdAt: "desc" }, take: 200 });
});
