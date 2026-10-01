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

test("manager gets the advances entry without finance navigation or route access", () => {
  const items = navItemsForRole(["MANAGER"]);
  assert.ok(items.some((item) => item.href === "/advances"));
  assert.equal(items.some((item) => item.href === "/finance"), false);
  assert.equal(authorize(["MANAGER"], "/advances"), true);
  assert.notEqual(authorize(["MANAGER"], "/finance/payroll"), true);
});

test("field roles cannot see or directly open advances", () => {
  assert.equal(navItemsForRole(["WORKER"]).some((item) => item.href === "/advances"), false);
  assert.notEqual(authorize(["WORKER"], "/advances"), true);
});

test("finance roles can use advances", () => {
  assert.ok(navItemsForRole(["ACCOUNTANT"]).some((item) => item.href === "/advances"));
  assert.equal(authorize(["ACCOUNTANT"], "/advances"), true);
});
