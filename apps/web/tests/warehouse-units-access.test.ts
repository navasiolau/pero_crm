import assert from "node:assert/strict";
import test from "node:test";
import type { Role } from "@prisma/client";
import { canAccessSettingsPath } from "../src/lib/settings-access";

test("warehouse unit settings grant ADMIN exclusively, including nested and trailing-slash paths", () => {
  for (const path of ["/settings/warehouse-units", "/settings/warehouse-units/", "/settings/warehouse-units/other"]) {
    assert.equal(canAccessSettingsPath(["ADMIN"], path), true);
    for (const role of ["DIRECTOR", "MANAGER", "ENGINEER", "PROCUREMENT", "ACCOUNTANT", "WORKER", "MOUNTER"] as Role[]) {
      assert.equal(canAccessSettingsPath([role], path), false, `${role} must not access ${path}`);
    }
  }
  assert.equal(canAccessSettingsPath(["DIRECTOR"], "/settings/payroll"), true);
  assert.equal(canAccessSettingsPath(["MANAGER", "ENGINEER"], "/settings/product-percentages"), true);
});