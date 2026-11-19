import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { proposalEditFingerprint } from "../src/server/kp/edit-checkpoint";
import { proposalCreationReversal } from "../src/server/kp/proposal-create-reversal";
import { issuedProposalPdfReversal } from "../src/server/kp/issued-pdf-reversal";
import { issuedContractDocxReversal } from "../src/server/kp/issued-docx-reversal";
import { savedContractDraftReversal } from "../src/server/kp/contract-draft-reversal";

const actor = { id: "director", name: "Директор", roles: ["DIRECTOR" as const], source: "web" as const };
const context = (tx: Prisma.TransactionClient) => ({ tx, actor, entityId: "proposal", entryId: "root" });
const empty = { findMany: async () => [] };

test("undo new quote hides project and quote together and refuses later dependent work", async () => {
  const project = { id: "project", deletedAt: null as Date | null, stage: "LEAD" };
  const proposal = { id: "proposal", deletedAt: null as Date | null, projectId: "project" };
  let children = [] as { id: string; projectId: string }[];
  const tx = { $queryRaw: async () => [],
    project: { findMany: async () => [project], update: async ({ data }: { data: { deletedAt: Date | null } }) => Object.assign(project, data) },
    commercialProposal: { findMany: async () => [proposal], findFirst: async () => proposal,
      update: async ({ data }: { data: { deletedAt: Date | null } }) => Object.assign(proposal, data) },
    product: { findMany: async () => children }, client: empty, file: empty, proposalItem: empty,
    proposalCurrentMedia: empty, proposalVersion: empty, proposalJob: empty, productStagePayPool: empty,
  } as unknown as Prisma.TransactionClient;
  const command = proposalCreationReversal.command({ proposalId: "proposal", projectId: "project", clientId: "client",
    expectedFingerprint: await proposalEditFingerprint(tx, "proposal", "project", "client"), expectedDeletedAt: null, hide: true });
  const handler = proposalCreationReversal.read(command.data)!;
  children = [{ id: "late-product", projectId: "project" }];
  await assert.rejects(handler.apply(context(tx)), /После создания изменились/);
  assert.equal(project.deletedAt, null);
  children = [];
  const hidden = await handler.apply(context(tx));
  assert.ok(project.deletedAt);
  assert.equal(proposal.deletedAt, project.deletedAt);
  await proposalCreationReversal.read(hidden.reversal.data)!.apply(context(tx));
  assert.equal(proposal.deletedAt, null);
  assert.equal(project.deletedAt, null);
});

test("creating a quote and changing a shared client reverses both through the office command", async () => {
  const project = { id: "project", clientId: "client", stage: "LEAD", deletedAt: null as Date | null };
  const quote = { id: "proposal", deletedAt: null as Date | null };
  const client = { id: "client", name: "После", deletedAt: null, officeFieldHeads: { name: "2" } };
  const tx = { $queryRaw: async () => [],
    project: { findMany: async () => [project], update: async ({ data }: { data: object }) => Object.assign(project, data) },
    commercialProposal: { findFirst: async () => quote, findMany: async () => [quote],
      update: async ({ data }: { data: object }) => Object.assign(quote, data) },
    client: { findMany: async () => [client], findUnique: async () => client,
      update: async ({ data }: { data: object }) => Object.assign(client, data) },
    domainEvent: { create: async () => ({ id: "updated-client" }) },
    product: empty, file: empty, proposalItem: empty, proposalCurrentMedia: empty,
    proposalVersion: empty, proposalJob: empty, productStagePayPool: empty,
  } as unknown as Prisma.TransactionClient;
  const command = proposalCreationReversal.command({
    proposalId: "proposal", projectId: "project", clientId: "client", expectedDeletedAt: null, hide: true,
    expectedFingerprint: await proposalEditFingerprint(tx, "proposal", "project", "client"),
    clientEffect: { clientId: "client", command: { kind: "office.directory", version: 1,
      data: { targetId: "client", steps: [{ id: "client", kind: "client", archiveCreated: false,
        fields: [{ key: "name", from: { value: "После", head: "2" }, to: { value: "До", head: "1" } }] }] } } },
  });
  const applied = await proposalCreationReversal.read(command.data)!.apply(context(tx));
  assert.equal(client.name, "До");
  assert.equal(quote.deletedAt, project.deletedAt);
  assert.ok(quote.deletedAt);
  assert.deepEqual(applied.eventIds, ["updated-client"]);
  await proposalCreationReversal.read(applied.reversal.data)!.apply(context(tx));
  assert.equal(client.name, "После");
  assert.equal(project.deletedAt, null);
});

test("standalone published PDF hides CRM output without changing the key and refuses issued contract dependencies", async () => {
  let uses = 0;
  const artifact = { key: "preserved-key", deletedAt: null as Date | null };
  const tx = { $queryRaw: async () => [],
    commercialProposal: { findUnique: async () => ({ projectId: "project" }) },
    proposalVersion: { findFirst: async () => ({ createdAt: new Date(), proposal: { projectId: "project" } }), count: async () => 0 },
    proposalContractVersion: { count: async () => uses },
    proposalArtifact: { update: async ({ data }: { data: { deletedAt: Date | null } }) => Object.assign(artifact, data) },
  } as unknown as Prisma.TransactionClient;
  const command = issuedProposalPdfReversal.command({ proposalId: "proposal", versionId: "version", artifactId: "pdf",
    revision: 1, expectedDeletedAt: null, hide: true });
  const handler = issuedProposalPdfReversal.read(command.data)!;
  uses = 1;
  await assert.rejects(handler.apply(context(tx)), /договор/);
  assert.equal(artifact.deletedAt, null);
  uses = 0;
  const hidden = await handler.apply(context(tx));
  assert.ok(artifact.deletedAt);
  assert.equal(artifact.key, "preserved-key");
  await issuedProposalPdfReversal.read(hidden.reversal.data)!.apply(context(tx));
  assert.equal(artifact.deletedAt, null);
});

test("independent contract output preserves accepted sources and blocks a later stage change", async () => {
  let stage = "CONTRACT";
  const artifact = { deletedAt: null as Date | null };
  const source = { proposalId: "proposal", projectId: "project", revision: 2, projectStage: stage, retainedVersionId: "accepted",
    binding: { clientId: "client" }, mode: "retained" };
  const tx = { $queryRaw: async () => [],
    proposalContractVersion: { findFirst: async () => ({ createdAt: new Date(), sourcesSnapshot: [source] }), count: async () => 0 },
    commercialProposal: { findMany: async () => [{ id: "proposal", revision: 2, clientId: "client", acceptedVersionId: "accepted",
      project: { id: "project", stage, deletedAt: null } }] },
    proposalArtifact: { update: async ({ data }: { data: { deletedAt: Date | null } }) => Object.assign(artifact, data) },
  } as unknown as Prisma.TransactionClient;
  const command = issuedContractDocxReversal.command({ contractId: "contract", versionId: "v", artifactId: "docx",
    revision: 1, expectedDeletedAt: null, hide: true });
  const handler = issuedContractDocxReversal.read(command.data)!;
  stage = "IN_WORK";
  await assert.rejects(handler.apply(context(tx)), /этапы/);
  stage = "CONTRACT";
  await handler.apply(context(tx));
  assert.ok(artifact.deletedAt);
});

test("contract draft reversal refuses once a newer export started", async () => {
  const tx = { proposalContract: { findFirst: async () => ({ jobs: [{ id: "later-job" }], versions: [] }) } } as unknown as Prisma.TransactionClient;
  const command = savedContractDraftReversal.command({ contractId: "contract", primaryId: "proposal", expectedRevision: 2,
    settings: {}, sourceIds: ["proposal"], sources: [{ proposalId: "proposal", projectId: "project", revision: 1,
      stage: "LEAD", clientId: "client" }], clients: [], versions: [] });
  assert.match(await savedContractDraftReversal.read(command.data)!.preview(context(tx)) ?? "", /выпуски изменились/);
});

