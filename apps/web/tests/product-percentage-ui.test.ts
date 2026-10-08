import assert from "node:assert/strict";
import test from "node:test";

import type { ProductPercentageKind } from "../src/lib/product-percentage-pay";
import type { ProductPercentageSectionView } from "../src/lib/product-percentage-view";
import {
  initialProductPercentageParticipants,
  addProductPercentageParticipant,
  canEditProductPercentageConfig,
  needsInstallationLegacyReview,
  installationLegacyReviewSatisfied,
  displayProductPercentageMemberAmount,
  previewProductPercentageShare,
  productStatusTargets,
  shouldRollbackProductStatus,
  toggleInstallationWorkSelection,
  transferOptionsForKind,
} from "../src/lib/product-percentage-ui";

const blankSection = (kind: ProductPercentageKind): ProductPercentageSectionView => ({
  kind,
  state: "DRAFT",
  hasConfiguration: false,
  ratePercent: null,
  price: "10000.00",
  productCurrency: "BYN",
  payrollCurrency: null,
  total: null,
  members: [],
  revision: 0,
  canManage: true,
  canTransfer: false,
  ownMember: null,
  legacyPaidSummary: null,
  skippedSnapshot: null,
  transferCandidates: [],
});

test("product status UI gives managers all statuses and engineers assigned DESIGN to PRODUCTION without model", () => {
  const context = { from: "DESIGN" as const, assignedEngineer: true, participant: false, hasB3d: false, noModel: false };
  assert.deepEqual(productStatusTargets(["MANAGER", "ENGINEER"] as const, context), ["DRAFT", "PREPARATION", "DESIGN", "PRODUCTION", "STORAGE", "INSTALLATION", "DONE", "RECLAMATION"]);
  assert.deepEqual(productStatusTargets(["ENGINEER"] as const, context), ["PRODUCTION"]);
  assert.deepEqual(productStatusTargets(["ENGINEER"] as const, { ...context, hasB3d: true }), ["PRODUCTION"]);
  assert.deepEqual(productStatusTargets(["WORKER"] as const, { ...context, hasB3d: true }), []);
});

test("persisted status with pending finance is successful and must not roll back", () => {
  assert.equal(shouldRollbackProductStatus({ ok: true, result: { financeState: "PENDING_FX" } }), false);
  assert.equal(shouldRollbackProductStatus({ ok: false, error: "rejected" }), true);
});

test("empty ENGINEERING configuration defaults to assigned engineer at 100 percent", () => {
  assert.deepEqual(initialProductPercentageParticipants("ENGINEERING", blankSection("ENGINEERING"), "engineer-1"), [
    { userId: "engineer-1", shareUnits: 1_000_000 },
  ]);
  assert.deepEqual(initialProductPercentageParticipants("INSTALLATION", blankSection("INSTALLATION"), null), []);
});

test("the first manually added member starts at 100 percent", () => {
  assert.deepEqual(addProductPercentageParticipant([], "mounter-1"), [
    { userId: "mounter-1", shareUnits: 1_000_000 },
  ]);
  assert.deepEqual(addProductPercentageParticipant([{ userId: "first", shareUnits: 1_000_000 }], "second"), [
    { userId: "first", shareUnits: 1_000_000 },
    { userId: "second", shareUnits: 0 },
  ]);
});

test("percentage panel previews each person's direct share in product currency", () => {
  assert.equal(previewProductPercentageShare("10000.00", "5", 700_000), "350.00");
  assert.equal(previewProductPercentageShare("10000.00", "5", 300_000), "150.00");
  assert.equal(previewProductPercentageShare("0.00", "5", 1_000_000), "0.00");
  assert.equal(previewProductPercentageShare(null, "5", 1_000_000), null);
  assert.equal(previewProductPercentageShare("10000.00", null, 1_000_000), null);
});

test("participant transfer options include active coworkers with combined roles only", () => {
  const users = [
    { id: "eng", name: "Инженер", active: true, roles: ["ENGINEER"] },
    { id: "manager-eng", name: "Менеджер-инженер", active: true, roles: ["MANAGER", "ENGINEER"] },
    { id: "off", name: "Неактивный инженер", active: false, roles: ["ENGINEER"] },
    { id: "mounter", name: "Монтажник", active: true, roles: ["MOUNTER"] },
  ];
  assert.deepEqual(transferOptionsForKind("ENGINEERING", users, "own"), [
    { value: "eng", label: "Инженер" },
    { value: "manager-eng", label: "Менеджер-инженер" },
  ]);
  assert.deepEqual(transferOptionsForKind("INSTALLATION", users, "own"), [
    { value: "mounter", label: "Монтажник" },
  ]);
});

test("installation source selector ignores ineligible paid or protected work", () => {
  assert.deepEqual(toggleInstallationWorkSelection([], "unpaid", true, true), ["unpaid"]);
  assert.deepEqual(toggleInstallationWorkSelection(["unpaid"], "unpaid", false, true), []);
  assert.deepEqual(toggleInstallationWorkSelection([], "paid", true, false), []);
});

test("first INSTALLATION config requires an explicit review only when legacy works exist", () => {
  assert.equal(needsInstallationLegacyReview("INSTALLATION", true), true);
  assert.equal(needsInstallationLegacyReview("INSTALLATION", false), false);
  assert.equal(needsInstallationLegacyReview("ENGINEERING", true), false);
  assert.equal(installationLegacyReviewSatisfied(true, false), false);
  assert.equal(installationLegacyReviewSatisfied(true, true), true);
  assert.equal(installationLegacyReviewSatisfied(false, false), true);
});

test("manager can save late SKIPPED_ONCE config without reopening settled or pending stages", () => {
  assert.equal(canEditProductPercentageConfig({ canManage: true, sectionCanManage: true, state: "SKIPPED_ONCE" }), true);
  assert.equal(canEditProductPercentageConfig({ canManage: true, sectionCanManage: false, state: "SKIPPED_ONCE" }), false);
  assert.equal(canEditProductPercentageConfig({ canManage: true, sectionCanManage: true, state: "SETTLED" }), false);
  assert.equal(canEditProductPercentageConfig({ canManage: true, sectionCanManage: true, state: "PENDING_FX" }), false);
});

test("late SKIPPED_ONCE setup never appears as a payable preview", () => {
  assert.equal(displayProductPercentageMemberAmount("SKIPPED_ONCE", "350.00", "350.00"), null);
  assert.equal(displayProductPercentageMemberAmount("DRAFT", null, "350.00"), "350.00");
  assert.equal(displayProductPercentageMemberAmount("SETTLED", "350.00", null), "350.00");
});
