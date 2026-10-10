import {matches} from "./helpers/visibility-fixture";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient, Role } from "@prisma/client";
import {
  canEditProductTechnicalBlock, engineeringParticipantProductIds, productEditWhere,
  productVisibilityWhere, projectVisibilityWhere, resolveVisibilityActor, taskExecutionWhere,
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
  const actor = await resolveVisibilityActor(db, { id: "u", roles: ["ENGINEER"] });
  assert.deepEqual(actor.engineeringParticipantProductIds, ["p"]);
  assert.deepEqual(actor.engineeringParticipantTaskIds, ["valid"]);
  assert.deepEqual(await engineeringParticipantProductIds(db, "u", false), ["p"]);
  assert.equal(canEditProductTechnicalBlock(actor, { id: "p", engineerId: null, status: "DESIGN" }), true);
  assert.equal(canEditProductTechnicalBlock(actor, { id: "p", engineerId: null, status: "PRODUCTION" }), false);
  assert.equal(canEditProductTechnicalBlock({ id: "u", roles: [] }, { id: "p", engineerId: null, status: "DESIGN" }), false);
});

test("participant predicates remain DESIGN scoped; independent manager and field grants survive", () => {
  const participant = { id: "u", roles: ["ENGINEER"] as Role[], engineeringParticipantProductIds: ["p"], engineeringParticipantTaskIds: ["task"] };
  const row={id:"p",engineerId:null,status:"DESIGN",deletedAt:null,project:{deletedAt:null}};
  assert.equal(matches(row,productEditWhere(participant)),true);
  for(const patch of [{status:"DRAFT"},{status:"PRODUCTION"},{id:"foreign"}])assert.equal(matches({...row,...patch},productEditWhere(participant)),false);
  const read = JSON.stringify(productVisibilityWhere(participant));
  assert.match(read, /DESIGN/);
  assert.match(read, /engineerId/);
  assert.match(read, /"p"/);
  const execution = JSON.stringify(taskExecutionWhere(participant));
  assert.match(execution, /"task"/);
  assert.match(execution, /DESIGN/);
  assert.equal(matches(row,productEditWhere({id:"u",roles:["MANAGER"]})),true);
  assert.equal(matches({...row,status:"DRAFT"},productEditWhere({id:"u",roles:["MANAGER"]})),false);
  const field = JSON.stringify(productVisibilityWhere({ id: "u", roles: ["WORKER"] }));
  assert.match(field, /assigneeId/);
  assert.match(field, /"in":\["PRODUCTION","STORAGE"\]/);
  for(const status of ["DRAFT","PREPARATION","DESIGN","PRODUCTION"])assert.equal(matches({...row,status},productVisibilityWhere({id:"u",roles:[]})),false,status);
});

test("legacy ENGINEERING recipient facts remain readable but no new split is offered", () => {
  const product = { engineerId: "primary", status: "DESIGN" as const };
  assert.notEqual(engineeringRecipientError({ id: "u", roles: [], active: true }, product), null);
  assert.notEqual(engineeringRecipientError({ id: "u", roles: ["ACCOUNTANT"], active: true }, product), null);
  assert.equal(engineeringRecipientError({ id: "u", roles: ["WORKER"], active: true }, product), null);
  assert.match(engineeringRecipientError({ id: "u", roles: [], active: false }, product) ?? "", /неактивен/);
  assert.equal(canSplitTask({ id: "u", roles: [] }, { assigneeId: "u", status: "NEW", product, paidCount: 0, work: { paymentKind: "ENGINEERING" } }), false);
  assert.equal(canSplitTask({ id: "u", roles: [] }, { assigneeId: "u", status: "DONE", product, paidCount: 0, work: { paymentKind: "ENGINEERING" } }), false);
  assert.equal(canSplitTask({ id: "u", roles: [] }, { assigneeId: "u", status: "NEW", product, paidCount: 1, work: { paymentKind: "ENGINEERING" } }), false);
});

test("direct participant grants are stage-scoped; pure field cannot see DESIGN sibling", async () => {
  const db = { task: { findMany: async () => [] }, productPercentageParticipant: {
    findMany: async ({ where }: { where: { config: { kind: string } } }) =>
      [{ config: { productId: where.config.kind === "ENGINEERING" ? "design-own" : "install-own" } }],
  } } as unknown as Pick<PrismaClient, "task" | "productPercentageParticipant">;
  const engineer = await resolveVisibilityActor(db, { id: "e", roles: ["ENGINEER"] });
  assert.deepEqual(engineer.engineeringParticipantProductIds, ["design-own"]);
  assert.match(JSON.stringify(productVisibilityWhere(engineer)), /design-own/);
  assert.match(JSON.stringify(productVisibilityWhere(engineer)), /engineerId/);
  const mounter = await resolveVisibilityActor(db, { id: "m", roles: ["MOUNTER"] });
  assert.deepEqual(mounter.fieldParticipantProductIds, ["install-own"]);
  const product = JSON.stringify(productVisibilityWhere(mounter));
  assert.match(product, /install-own/);
  assert.match(product, /"in":\["INSTALLATION"\]/);
  const project = JSON.stringify(projectVisibilityWhere(mounter));
  assert.match(project, /"products"/);
  assert.match(project, /"none":\{\}/);
});
