import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient, Role } from "@prisma/client";
import {
  canEditProductTechnicalBlock, engineeringParticipantProductIds, productEditWhere,
  productVisibilityWhere, resolveVisibilityActor, taskExecutionWhere,
} from "../src/server/access/visibility";
import { canSplitTask, engineeringRecipientError } from "../src/server/tasks/share-policy";

function dbFor(rows: Array<{ id: string; productId: string | null; projectId: string; product: { projectId: string } | null; work: { productId: string | null; projectId: string } | null }>) {
  return { task: { findMany: async () => rows } } as unknown as Pick<PrismaClient, "task">;
}

test("participant resolver accepts zero-share assignment and rejects every mismatched link", async () => {
  const valid = { id: "valid", productId: "p", projectId: "project", product: { projectId: "project" }, work: { productId: "p", projectId: "project" } };
  const db = dbFor([
    valid,
    { ...valid, productId: "other" },
    { ...valid, product: { projectId: "other" } },
    { ...valid, work: { productId: "other", projectId: "project" } },
    { ...valid, work: { productId: "p", projectId: "other" } },
    { ...valid, work: null },
  ]);
  const actor = await resolveVisibilityActor(db, { id: "u", roles: [] });
  assert.deepEqual(actor.engineeringParticipantProductIds, ["p"]);
  assert.deepEqual(actor.engineeringParticipantTaskIds, ["valid"]);
  assert.deepEqual(await engineeringParticipantProductIds(db, "u", false), ["p"]);
  assert.equal(canEditProductTechnicalBlock(actor, { id: "p", engineerId: null, status: "DESIGN" }), true);
  assert.equal(canEditProductTechnicalBlock(actor, { id: "p", engineerId: null, status: "PRODUCTION" }), false);
  assert.equal(canEditProductTechnicalBlock({ id: "u", roles: [] }, { id: "p", engineerId: null, status: "DESIGN" }), false);
});

test("participant predicates remain DESIGN scoped; independent manager and field grants survive", () => {
  const participant = { id: "u", roles: [] as Role[], engineeringParticipantProductIds: ["p"], engineeringParticipantTaskIds: ["task"] };
  assert.deepEqual(productEditWhere(participant), { status: "DESIGN", OR: [{ id: { in: ["p"] } }] });
  const read = JSON.stringify(productVisibilityWhere(participant));
  assert.match(read, /DESIGN/);
  assert.match(read, /"p"/);
  const execution = JSON.stringify(taskExecutionWhere(participant));
  assert.match(execution, /"task"/);
  assert.match(execution, /DESIGN/);
  assert.deepEqual(productEditWhere({ id: "u", roles: ["MANAGER"] }), {});
  assert.match(JSON.stringify(productVisibilityWhere({ id: "u", roles: ["WORKER"] })), /assigneeId/);
});

test("active recipient of any role, including zero roles, may receive ENGINEERING split", () => {
  const product = { engineerId: "primary", status: "DESIGN" as const };
  assert.equal(engineeringRecipientError({ id: "u", roles: [], active: true }, product), null);
  assert.equal(engineeringRecipientError({ id: "u", roles: ["ACCOUNTANT"], active: true }, product), null);
  assert.match(engineeringRecipientError({ id: "u", roles: [], active: false }, product) ?? "", /неактивен/);
  assert.equal(canSplitTask({ id: "u", roles: [] }, { assigneeId: "u", status: "NEW", product, paidCount: 0, work: { paymentKind: "ENGINEERING" } }), true);
  assert.equal(canSplitTask({ id: "u", roles: [] }, { assigneeId: "u", status: "DONE", product, paidCount: 0, work: { paymentKind: "ENGINEERING" } }), false);
  assert.equal(canSplitTask({ id: "u", roles: [] }, { assigneeId: "u", status: "NEW", product, paidCount: 1, work: { paymentKind: "ENGINEERING" } }), false);
});
