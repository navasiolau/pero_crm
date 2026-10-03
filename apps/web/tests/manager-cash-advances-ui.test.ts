import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session } from "next-auth";
import type { NextRequest } from "next/server";

import { authConfig } from "../src/auth.config";
import { navItemsForRole } from "../src/lib/nav";
import type { Role } from "../src/lib/roles";

function session(roles: Role[]): Session {
  return { user: { id: "cash-ui", name: "Cash UI", roles, sessionVersion: 1 }, expires: "2099-01-01" };
}

function authorize(roles: Role[], pathname: string) {
  return authConfig.callbacks.authorized({
    auth: session(roles),
    request: { nextUrl: new URL(`https://crm.example.invalid${pathname}`) } as NextRequest,
  });
}

test("pure manager has neither advance nor finance navigation or route access", () => {
  const items = navItemsForRole(["MANAGER"]);
  assert.equal(items.some((item) => item.href === "/advances"), false);
  assert.equal(items.some((item) => item.href === "/finance"), false);
  assert.notEqual(authorize(["MANAGER"], "/advances"), true);
  assert.notEqual(authorize(["MANAGER"], "/finance/payroll"), true);
});

test("field roles cannot see or directly open advances", () => {
  assert.equal(navItemsForRole(["WORKER"]).some((item) => item.href === "/advances"), false);
  assert.notEqual(authorize(["WORKER"], "/advances"), true);
});

test("advances live within finance for financial and combined roles", () => {
  for (const roles of [["ADMIN"], ["DIRECTOR"], ["ACCOUNTANT"], ["PROCUREMENT"], ["MANAGER", "ACCOUNTANT"]] as Role[][]) {
    assert.equal(navItemsForRole(roles).some((item) => item.href === "/advances"), false);
    assert.ok(navItemsForRole(roles).some((item) => item.href === "/finance"));
    assert.equal(authorize(roles, "/finance/advances"), true);
    assert.equal(authorize(roles, "/advances"), true);
  }
  for (const role of ["MANAGER", "ENGINEER", "WORKER", "MOUNTER"] as Role[]) {
    assert.notEqual(authorize([role], "/finance/advances"), true);
  }
});
