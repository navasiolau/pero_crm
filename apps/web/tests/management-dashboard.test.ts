import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session } from "next-auth";
import type { NextRequest } from "next/server";

import { authConfig } from "../src/auth.config";
import { navItemsForRole } from "../src/lib/nav";
import type { Role } from "../src/lib/roles";
import { createSessionCallbacks, type SessionUser } from "../src/server/auth/session-callbacks";

const account: SessionUser = {
  id: "dashboard-test-user",
  email: "dashboard-test@example.invalid",
  name: "Dashboard test",
  roles: ["MANAGER"],
  active: true,
  sessionVersion: 1,
};

function session(roles: Role[]): Session {
  return { user: { ...account, roles }, expires: "2099-01-01T00:00:00.000Z" };
}

function authorize(auth: Session | null, pathname = "/") {
  return authConfig.callbacks.authorized({
    auth,
    request: { nextUrl: new URL(`https://crm.example.invalid${pathname}`) } as NextRequest,
  });
}

const roleCases: { roles: Role[]; home: string }[] = [
  { roles: ["ADMIN"], home: "/" },
  { roles: ["DIRECTOR"], home: "/" },
  { roles: ["MANAGER"], home: "/" },
  { roles: ["MANAGER", "ENGINEER"], home: "/" },
  { roles: ["WORKER", "MANAGER"], home: "/" },
  { roles: ["ENGINEER"], home: "/products" },
  { roles: ["ENGINEER", "WORKER"], home: "/products" },
  { roles: ["ACCOUNTANT", "ENGINEER"], home: "/products" },
  { roles: ["ACCOUNTANT"], home: "/finance" },
  { roles: ["MOUNTER", "ACCOUNTANT"], home: "/finance" },
  { roles: ["WORKER"], home: "/my" },
  { roles: ["MOUNTER"], home: "/my" },
  { roles: ["WORKER", "MOUNTER"], home: "/my" },
];

for (const { roles, home } of roleCases) {
  const label = roles.join(" + ") || "no roles";

  test(`${label}: a direct root request receives only its permitted home`, () => {
    const result = authorize(session(roles));
    if (home === "/") {
      assert.equal(result, true);
    } else {
      assert.ok(result instanceof Response, "must redirect instead of allowing dashboard data");
      assert.equal(result.headers.get("location"), `https://crm.example.invalid${home}`);
      assert.equal(authorize(session(roles), home), true, "destination must not loop");
    }
  });

  test(`${label}: dashboard navigation matches server access`, () => {
    const items = navItemsForRole(roles);
    assert.equal(items.some((item) => item.href === "/"), home === "/");
    if (roles.length > 0) {
      assert.ok(items.some((item) => item.href === home), "home must be present in navigation");
    }
  });
}

test("combined engineer/accountant keeps finance and personal tasks, without a dashboard", () => {
  const items = navItemsForRole(["ENGINEER", "ACCOUNTANT"]);
  for (const href of ["/products", "/finance", "/my", "/payroll"]) {
    assert.ok(items.some((item) => item.href === href), href);
  }
  assert.equal(authorize(session(["ENGINEER", "ACCOUNTANT"]), "/finance"), true);
});

test("director keeps the dashboard and does not gain personal payroll navigation", () => {
  assert.equal(authorize(session(["DIRECTOR"])), true);
  assert.equal(navItemsForRole(["DIRECTOR"]).some((item) => item.href === "/payroll"), false);
});

test("unauthenticated root requests require login", () => {
  assert.equal(authorize(null), false);
});

test("authenticated account without roles fails closed without redirecting to a forbidden home", () => {
  for (const path of ["/", "/my", "/finance", "/products"]) {
    assert.equal(authorize(session([]), path), false);
  }
  assert.deepEqual(navItemsForRole([]), []);
});

test("an old manager claim cannot grant dashboard access after current roles change", async () => {
  const callbacks = createSessionCallbacks(async () => ({ ...account, roles: ["ENGINEER"] }));
  const current = await callbacks.jwt({
    token: { id: account.id, roles: ["MANAGER"], sessionVersion: 1 },
    account: null,
    user: undefined as never,
  });
  assert.ok(current);
  const currentSession = authConfig.callbacks.session({ session: session(["MANAGER"]), token: current } as never);
  const result = authorize(currentSession);
  assert.ok(result instanceof Response);
  assert.equal(result.headers.get("location"), "https://crm.example.invalid/products");
});
