import assert from "node:assert/strict";
import { test } from "node:test";
import { Prisma } from "@prisma/client";
import { proposalEditCommand, proposalEditFingerprint, rememberEditCheckpoint, type EditBaseline } from "../src/server/kp/edit-checkpoint";
import { proposalEditReversal } from "../src/server/kp/edit-reversal";

const fx = { currency: "BYN", rate: "1", rateDate: "2026-11-20", rateSource: "MANUAL" } as const;
const proposal = { id: "proposal", projectId: "project", clientId: "client", revision: 3,
  acceptedVersionId: null, deletedAt: null, rate: new Prisma.Decimal(1), rateDate: new Date("2026-11-20"),
  rateSource: "MANUAL", currency: "BYN", state: { items: [{ id: "item", name: "Прежняя редакция" }] },
};
const baseline: EditBaseline = { rate: fx, mediaIds: ["media"], products: new Map() };

test("edit checkpoint references an exact existing version and creates only absent immutable state", async () => {
  const existing = { id: "published", state: proposal.state,
    renderSnapshot: { binding: { clientId: proposal.clientId }, ...fx }, media: [{ mediaId: "media" }] };
  let candidates = [existing], created = 0;
  const tx = {
    proposalVersion: { findMany: async () => candidates, create: async ({ data }: { data: { trigger: string; state: unknown } }) => {
      created++; assert.equal(data.trigger, "EDIT"); assert.equal(data.state, proposal.state); return { id: "checkpoint" };
    } },
    proposalVersionMedia: { createMany: async ({ data }: { data: unknown }) =>
      assert.deepEqual(data, [{ proposalId: "proposal", versionId: "checkpoint", mediaId: "media" }]) },
  } as unknown as Prisma.TransactionClient;
  assert.equal(await rememberEditCheckpoint(tx, proposal, baseline, "actor"), "published");
  assert.equal(created, 0);
  candidates = [{ ...existing, media: [] }];
  assert.equal(await rememberEditCheckpoint(tx, proposal, baseline, "actor"), "checkpoint");
  assert.equal(created, 1);
});

test("edit reversal detects a change to dependent storage bindings and a later proposal revision", async () => {
  let revision = proposal.revision, files: object[] = [];
  const tx = {
    commercialProposal: { findUnique: async () => ({ ...proposal, revision }), findMany: async () => [{ ...proposal, revision }] },
    project: { findUnique: async () => ({ id: "project", stage: "LEAD", clientId: "client", deletedAt: null }),
      findMany: async () => [{ id: "project", stage: "LEAD", clientId: "client", deletedAt: null }] },
    product: { findMany: async () => [] }, client: { findMany: async () => [] },
    file: { findMany: async () => files },
    proposalItem: { findMany: async () => [] }, proposalCurrentMedia: { findMany: async () => [] },
    proposalVersion: { findMany: async () => [], findFirst: async () => ({
      id: "published", media: [], renderSnapshot: { binding: { clientId: "client" }, ...fx },
    }) },
    proposalJob: { findMany: async () => [] }, productStagePayPool: { findMany: async () => [] },
  } as unknown as Prisma.TransactionClient;
  const cmd = proposalEditCommand({ proposalId: "proposal", projectId: "project", checkpointId: "published",
    expectedRevision: revision, expectedFingerprint: await proposalEditFingerprint(tx, "proposal", "project", "client") });
  const handler = proposalEditReversal.read(cmd.data)!;
  const context = { tx, actor: { id: "admin", name: "Администратор", roles: ["ADMIN" as const], source: "web" as const },
    entityId: "proposal", entryId: "edit-entry" };
  files = [{ id: "new-file", projectId: "project" }];
  assert.match(await handler.preview(context) ?? "", /Связанные данные изменились/);
  revision++;
  assert.match(await handler.preview(context) ?? "", /КП уже изменено/);
});

