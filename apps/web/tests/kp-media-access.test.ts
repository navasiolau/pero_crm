import { test } from "node:test";
import assert from "node:assert/strict";
import type { Role } from "@prisma/client";
import { assertProposalMediaAccess } from "../src/server/kp/media-access";
import { ProposalMediaError } from "../src/server/kp/media-contract";

const owner = { proposalId: "proposal", projectId: "project", revision: 3, deletedAt: null, isArchive: false,
  stage: "LEAD", projectDeletedAt: null };
const user = (roles: Role[], active = true) => ({ roles, active });
test("media ACL uses current live management roles, including manager-engineer union", () => {
  for (const roles of [["ADMIN"], ["DIRECTOR"], ["MANAGER"], ["MANAGER", "ENGINEER"]] as Role[][])
    assert.doesNotThrow(() => assertProposalMediaAccess(user(roles), owner, true, 3));
  for (const roles of [[], ["ENGINEER"], ["ACCOUNTANT"], ["PROCUREMENT"], ["WORKER"], ["MOUNTER"], ["ADMIN", "ENGINEER"]] as Role[][])
    assert.throws(() => assertProposalMediaAccess(user(roles), owner, false),
      error => error instanceof ProposalMediaError && error.code === "KP_MEDIA_FORBIDDEN");
  assert.throws(() => assertProposalMediaAccess(user(["ADMIN"], false), owner, false), /прав/);
  assert.throws(() => assertProposalMediaAccess(null, owner, false), /прав/);
});
test("media writes require live Lead and matching revision; readonly archive remains available", () => {
  const manager = user(["MANAGER"]);
  for (const stage of ["ESTIMATE", "CONTRACT", "IN_WORK", "DONE", "PAUSED", "REFUSED"])
    assert.throws(() => assertProposalMediaAccess(manager, { ...owner, stage }, true, 3), /Лид/);
  assert.doesNotThrow(() => assertProposalMediaAccess(manager, { ...owner, stage: "IN_WORK" }, false));
  assert.throws(() => assertProposalMediaAccess(manager, owner, true, 2), /изменилось/);
  assert.throws(() => assertProposalMediaAccess(manager, { ...owner, projectDeletedAt: new Date() }, false), /недоступно/);
  assert.throws(() => assertProposalMediaAccess(manager, { ...owner, deletedAt: new Date() }, false), /недоступно/);
  assert.throws(() => assertProposalMediaAccess(manager, { ...owner, projectId: null }, false), /недоступно/);
  const archive = { ...owner, projectId: null, stage: null, isArchive: true };
  assert.doesNotThrow(() => assertProposalMediaAccess(manager, archive, false));
  assert.throws(() => assertProposalMediaAccess(manager, archive, true), /Лид/);
});
