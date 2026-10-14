import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session } from "next-auth";
import type { NextRequest } from "next/server";
import type { Role } from "../src/lib/roles";
import { authConfig } from "../src/auth.config";
import { navItemsForRole } from "../src/lib/nav";

const session = (roles: Role[]): Session => ({ user: { id: "home-test", roles, sessionVersion: 0 }, expires: "2099-01-01" });
const authorize = (roles: Role[] | null, path = "/") => authConfig.callbacks.authorized({
  auth: roles ? session(roles) : null, request: { nextUrl: new URL("https://crm.example.invalid" + path) } as NextRequest,
});

test("root chooses the permitted home and the destination does not redirect again", () => {
  const cases: [Role[], string][] = [
    [["ADMIN"], "/"], [["DIRECTOR"], "/"], [["MANAGER"], "/"], [["WORKER", "MANAGER"], "/"],
    [["ENGINEER"], "/products"], [["ENGINEER", "WORKER"], "/products"], [["ACCOUNTANT", "ENGINEER"], "/products"],
    [["ACCOUNTANT"], "/finance"], [["MOUNTER", "ACCOUNTANT"], "/finance"], [["WORKER"], "/my"], [["MOUNTER"], "/my"],
  ];
  for (const [roles, home] of cases) {
    const result = authorize(roles);
    if (home === "/") assert.equal(result, true);
    else {
      assert.ok(result instanceof Response);
      assert.equal(result.headers.get("location"), "https://crm.example.invalid" + home);
      assert.equal(authorize(roles, home), true);
    }
  }
  assert.equal(authorize(null), false);
  for (const path of ["/", "/my", "/finance", "/products"]) assert.equal(authorize([], path), false);
});

test("combined roles retain independent finance/personal grants without a dashboard", () => {
  const links = navItemsForRole(["ENGINEER", "ACCOUNTANT"]).map(item => item.href);
  for (const path of ["/products", "/finance", "/my", "/payroll"]) assert.ok(links.includes(path));
  assert.equal(links.includes("/"), false);
  assert.equal(authorize(["ENGINEER", "ACCOUNTANT"], "/finance"), true);
  assert.equal(navItemsForRole(["DIRECTOR"]).some(item => item.href === "/payroll"), false);
  assert.deepEqual(navItemsForRole([]), []);
});
