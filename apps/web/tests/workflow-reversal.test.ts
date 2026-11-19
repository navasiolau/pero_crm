import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma, Role } from "@prisma/client";
import { productStatusReversal, productWorkflowCommand } from "../src/server/products/status-reversal";
import { productPercentageDefaultsReversal } from "../src/server/product-percentage-defaults/reversal";
import { DEFAULT_PERCENTAGE_KEY, EMPTY_DEFAULTS } from "../src/server/product-percentage-defaults/contracts";
import { fieldCommand } from "../src/server/changelog/field-reversal";

const actor = { id: "director", name: "Директор", roles: ["DIRECTOR"] as Role[], source: "web" as const };
const context = { actor, entityId: "product", entryId: "original", reversalId: "undo" };

test("status compensation uses original clock and adds a new history row; dependency drift and pending FX block", async () => {
  const oldAt = new Date("2026-01-01T10:00:00Z"), changedAt = new Date("2026-02-01T10:00:00Z");
  const before = { id: "product", projectId: "project", number: "1.1", status: "DESIGN" as const, statusChangedAt: oldAt,
    workflowRevision: 4, engineerId: null, assemblerId: null, mounterId: null };
  const current = { ...before, status: "PRODUCTION", statusChangedAt: changedAt, workflowRevision: 5 };
  const history: unknown[] = [];
  let stamp = "baseline";
  const tx = {
    $queryRaw: async (query: TemplateStringsArray) => query.join("").includes("md5") ? [{ value: stamp }] : [],
    product: {
      findFirst: async () => ({ ...current }),
      update: async ({ data }: { data: Partial<typeof current> }) => ({ ...Object.assign(current, data), workflowRevision: ++current.workflowRevision }),
    },
    productStatusHistory: { create: async ({ data }: { data: unknown }) => history.push(data) },
    domainEvent: { create: async () => ({ id: "event" }) },
  } as unknown as Prisma.TransactionClient;
  const command = productWorkflowCommand(before, "PRODUCTION", changedAt, stamp, null, false);
  const reversal = productStatusReversal.read(command?.data);
  assert.ok(reversal);
  stamp = "changed";
  await assert.rejects(() => reversal.apply({ ...context, tx }), /изменились работы/);
  assert.equal(current.status, "PRODUCTION");
  assert.equal(history.length, 0);

  stamp = "baseline";
  const pending = productStatusReversal.read(productWorkflowCommand(before, "PRODUCTION", changedAt, stamp, null, true)?.data);
  assert.ok(pending);
  await assert.rejects(() => pending.preview({ ...context, tx }), /ожидает валютный курс/);
  const undone = await reversal.apply({ ...context, tx });
  assert.equal(current.status, "DESIGN");
  assert.equal(current.statusChangedAt.toISOString(), oldAt.toISOString());
  assert.deepEqual(history, [{ productId: "product", fromStatus: "PRODUCTION", toStatus: "DESIGN",
    changedById: "director", comment: "Откат действия original" }]);
  const redo = productStatusReversal.read(undone.reversal.data);
  assert.ok(redo);
  await redo.apply({ ...context, tx, entryId: "undo", reversalId: "redo" });
  assert.equal(current.status, "PRODUCTION");
  assert.equal(current.statusChangedAt.toISOString(), changedAt.toISOString());
});

test("default percentages restore a legacy empty value through a new revision", async () => {
  const rates = { ENGINEERING: "5.00", ASSEMBLY: "2.00", INSTALLATION: "0.00" };
  let value = JSON.stringify({ revision: 1, rates });
  const tx = {
    $queryRaw: async () => [],
    orgSetting: { findUnique: async () => ({ value }),
      upsert: async ({ update }: { update: { value: string } }) => { value = update.value; } },
  } as unknown as Prisma.TransactionClient;
  const command = fieldCommand("orgSetting.percentageDefaults", { value: EMPTY_DEFAULTS.rates, revision: 0 }, { value: rates, revision: 1 });
  const reversal = productPercentageDefaultsReversal.read(command?.data);
  assert.ok(reversal);
  await reversal.apply({ ...context, tx, entityId: DEFAULT_PERCENTAGE_KEY });
  assert.deepEqual(JSON.parse(value), { revision: 2, rates: EMPTY_DEFAULTS.rates });
});
