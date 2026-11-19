import assert from "node:assert/strict";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { proposalEditFingerprint } from "../src/server/kp/edit-checkpoint";
import { contractPublicationReversal } from "../src/server/kp/contract-publication-reversal";
import { createdContractDraftReversal } from "../src/server/kp/contract-draft-reversal";

const empty = { findMany: async () => [] };
const actor = { id: "admin", name: "Администратор", roles: ["ADMIN" as const], source: "web" as const };
const context = (tx: Prisma.TransactionClient) => ({ tx, actor, entityId: "contract", entryId: "release" });

test("initial draft hides only its own row and restores its existing ordered source bindings", async () => {
  const row = { deletedAt: null as Date | null, sources: [{ proposalId: "proposal" }], versions: [],
    _count: { jobs: 0, versions: 0 }, jobs: [] };
  const tx = { $queryRaw: async () => [], client: empty,
    proposalContract: { findFirst: async ({ where }: { where: { deletedAt: Date | null } }) =>
      where.deletedAt?.getTime() === row.deletedAt?.getTime() ? row : null,
      update: async ({ data }: { data: { deletedAt: Date | null } }) => Object.assign(row, data) },
    commercialProposal: { findMany: async () => [{ id: "proposal", clientId: "client", revision: 1,
      project: { id: "project", stage: "LEAD", clientId: "client", deletedAt: null } }] },
  } as unknown as Prisma.TransactionClient;
  const cmd = createdContractDraftReversal.command({ contractId: "contract", primaryId: "proposal", expectedRevision: 1,
    sourceIds: ["proposal"], sources: [{ proposalId: "proposal", projectId: "project", revision: 1, stage: "LEAD", clientId: "client" }],
    clients: [], versions: [], expectedDeletedAt: null, hide: true });
  const handler = createdContractDraftReversal.read(cmd.data)!;
  row._count.jobs = 1;
  assert.notEqual(await handler.preview(context(tx)), null);
  row._count.jobs = 0;
  const hidden = await handler.apply(context(tx));
  assert.ok(row.deletedAt);
  await createdContractDraftReversal.read(hidden.reversal.data)!.apply(context(tx));
  assert.equal(row.deletedAt, null);
  assert.deepEqual(row.sources, [{ proposalId: "proposal" }]);
});

test("first combined publication reverts both project stages and promotion, keeps bytes, and refuses later work", async () => {
  const projects = { p1: { stage: "CONTRACT", workCount: 0 }, p2: { stage: "CONTRACT", workCount: 0 } };
  const acceptedAt = "2026-11-20T10:00:00.000Z";
  const proposals = { c1: { acceptedVersionId: "generated", acceptedAt }, c2: { acceptedVersionId: "existing", acceptedAt } };
  const products = { item: { status: "PREPARATION" } };
  const assets = { docx: { state: "READY", deletedAt: null as Date | null, key: "docx-bytes" },
    pdf: { state: "READY", deletedAt: null as Date | null, key: "pdf-bytes" } };
  const history: unknown[] = [];
  const tx = { $queryRaw: async () => [],
    project: { findMany: async () => Object.entries(projects).map(([id, project]) => ({ id, ...project })),
      updateMany: async ({ where, data }: { where: { id: keyof typeof projects }; data: object }) => {
        Object.assign(projects[where.id], data); return { count: 1 };
      } },
    commercialProposal: { findMany: async () => Object.entries(proposals).map(([id, proposal]) => ({ id, ...proposal })),
      updateMany: async ({ where, data }: { where: { id: keyof typeof proposals }; data: object }) => {
        Object.assign(proposals[where.id], data); return { count: 1 };
      } },
    product: { findMany: async () => Object.entries(products).map(([id, product]) => ({ id, projectId: "p1", ...product })),
      updateMany: async ({ where, data }: { where: { id: keyof typeof products }; data: object }) => {
        Object.assign(products[where.id], data); return { count: 1 };
      } },
    proposalArtifact: { updateMany: async ({ data }: { data: { deletedAt: Date | null } }) => {
      for (const asset of Object.values(assets)) Object.assign(asset, data);
      return { count: 2 };
    } },
    proposalContractVersion: { count: async () => 0, findFirst: async () => ({ id: "version", docxArtifactId: "docx",
      docxArtifact: assets.docx, contract: { revision: 1, deletedAt: null } }) },
    proposalVersion: { findMany: async () => [{ ...assets.pdf, id: "generated", proposalId: "c1", pdfArtifactId: "pdf" }] },
    projectStageHistory: { create: async (args: unknown) => history.push(args) },
    productStatusHistory: { create: async (args: unknown) => history.push(args) },
    client: empty, file: empty, proposalItem: empty, proposalCurrentMedia: empty, proposalJob: empty, productStagePayPool: empty,
  } as unknown as Prisma.TransactionClient;
  const command = contractPublicationReversal.command({
    contractId: "contract", versionId: "version", docxArtifactId: "docx", revision: 1,
    pdfs: [{ versionId: "generated", artifactId: "pdf", proposalId: "c1" }],
    transitions: [{ proposalId: "c1", projectId: "p1", promoted: ["item"],
      prior: { stage: "LEAD", acceptedVersionId: null, acceptedAt: null },
      issued: { stage: "CONTRACT", acceptedVersionId: "generated", acceptedAt } },
    { proposalId: "c2", projectId: "p2", promoted: [],
      prior: { stage: "ESTIMATE", acceptedVersionId: "existing", acceptedAt },
      issued: { stage: "CONTRACT", acceptedVersionId: "existing", acceptedAt } }],
    scope: [{ proposalId: "c1", projectId: "p1", clientId: "client", fingerprint: await proposalEditFingerprint(tx, "c1", "p1", "client") },
      { proposalId: "c2", projectId: "p2", clientId: "client", fingerprint: await proposalEditFingerprint(tx, "c2", "p2", "client") }],
    expectedDeletedAt: null, hide: true,
  });
  const handler = contractPublicationReversal.read(command.data)!;
  projects.p2.workCount++;
  await assert.rejects(handler.apply(context(tx)), /изменились этапы/);
  assert.equal(projects.p1.stage, "CONTRACT");
  assert.equal(assets.docx.deletedAt, null);
  projects.p2.workCount--;
  const reversed = await handler.apply(context(tx));
  assert.deepEqual([projects.p1.stage, projects.p2.stage, products.item.status], ["LEAD", "ESTIMATE", "DRAFT"]);
  assert.equal(proposals.c1.acceptedVersionId, null);
  assert.equal(proposals.c2.acceptedVersionId, "existing");
  assert.ok(assets.docx.deletedAt && assets.pdf.deletedAt);
  assert.deepEqual([assets.docx.key, assets.pdf.key], ["docx-bytes", "pdf-bytes"]);
  await contractPublicationReversal.read(reversed.reversal.data)!.apply(context(tx));
  assert.deepEqual([projects.p1.stage, projects.p2.stage, products.item.status], ["CONTRACT", "CONTRACT", "PREPARATION"]);
  assert.equal(proposals.c1.acceptedVersionId, "generated");
  assert.equal(assets.docx.deletedAt, null);
  assert.equal(history.length, 6);
});

