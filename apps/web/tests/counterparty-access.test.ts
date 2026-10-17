import assert from "node:assert/strict";
import { test } from "node:test";
import type { Role } from "@prisma/client";
import { canAccessOperationalPath } from "../src/lib/operational-access";
import { navItemsForRole, sectionTitle } from "../src/lib/nav";

const allowed: Role[][] = [["ADMIN"], ["DIRECTOR"], ["MANAGER"], ["PROCUREMENT"], ["ENGINEER", "PROCUREMENT"], ["ACCOUNTANT", "MANAGER"]];
const denied: Role[][] = [["ENGINEER"], ["ACCOUNTANT"], ["WORKER"], ["MOUNTER"], ["WORK_COORDINATOR"], [], ["ENGINEER", "ACCOUNTANT"]];

test("counterparty navigation grants only the four directory roles and role unions", () => {
  for (const roles of allowed) assert.equal(navItemsForRole(roles).some(item => item.href === "/counterparties"), true, roles.join("+"));
  for (const roles of denied) assert.equal(navItemsForRole(roles).some(item => item.href === "/counterparties"), false, roles.join("+"));
  assert.equal(sectionTitle("/counterparties"), "Контрагенты");
});

test("counterparty direct path policy rejects pure finance/engineering and grants independent directory roles", () => {
  for (const pathname of ["/counterparties", "/counterparties/record"]) {
    for (const roles of allowed) assert.equal(canAccessOperationalPath(roles, pathname), true, `${roles.join("+")} ${pathname}`);
    for (const roles of denied) assert.equal(canAccessOperationalPath(roles, pathname), false, `${roles.join("+")} ${pathname}`);
  }
});
