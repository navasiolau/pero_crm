import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, Role } from "@prisma/client";
import { projectProposalPdfFile, readProjectProposalPdf, publishedProjectPdfPaths } from "../src/server/kp/project-pdf";
import { generalProjectFileVisibilityWhere, fileVisibilityWhere } from "../src/server/access/visibility";
import { getViewableFileSource } from "../src/lib/viewable-file";
import { fixtureModel, matches, type FixtureRow } from "./helpers/visibility-fixture";

const actor = (roles: Role[] = ["MANAGER"]) => ({ id: "reader", roles });
function fixture() {
  const project: FixtureRow = { id: "project", stage: "LEAD", deletedAt: null, products: [], tasks: [] };
  const proposal: FixtureRow = { id: "proposal", projectId: "project", project, isArchive: false, deletedAt: null,
    revision: 1, acceptedVersionId: null };
  const versions: FixtureRow[] = [];
  const publish = (id: string, at: number, artifactState = "READY") => {
    const artifact = { id: `artifact-${id}`, proposalId: "proposal", contractId: null, kind: "PDF", state: artifactState,
      deletedAt: null, fileName: "КП.pdf", mimeType: "application/pdf", key: `kp/proposals/proposal/exports/${id}.pdf`,
      storageBinding: { endpoint: "https://storage.example.invalid", bucket: "private-kp", region: "us-east-1" }, sha256: "a".repeat(64), size: 3 };
    const version = { id, proposalId: "proposal", revision: 1, state: { order: { number: id } },
      pdfArtifactId: artifact.id, pdfArtifact: artifact, createdAt: new Date(at) };
    versions.push(version); return version;
  };
  const db = { commercialProposal: fixtureModel([proposal]), proposalVersion: fixtureModel(versions),
    task: fixtureModel([]), productPercentageParticipant: fixtureModel([]) } as unknown as Prisma.TransactionClient;
  return { db, project, proposal, versions, publish };
}

test("project PDF appears from existing successful versions and one stable row follows the latest publication", async () => {
  const f = fixture();
  f.proposal.isArchive = true;
  assert.equal(await projectProposalPdfFile(f.db, actor(), "project"), null);
  f.publish("first", 1);
  const first = await projectProposalPdfFile(f.db, actor(), "project");
  assert.deepEqual(first, { id: "project", fileName: "КП_first.pdf", mimeType: "application/pdf", source: "proposal", section: "GENERAL", canDelete: false });
  const oldUrl = getViewableFileSource(first!);
  assert.equal(oldUrl, "/api/projects/project/proposal-pdf");
  const history = structuredClone(f.versions);
  f.proposal.revision = 2;
  f.publish("second", 2);
  const second = await projectProposalPdfFile(f.db, actor(), "project");
  assert.equal(second?.fileName, "КП_second.pdf");
  assert.equal(getViewableFileSource(second!), oldUrl);
  assert.deepEqual(f.versions[0], history[0], "projection does not rewrite or delete previous versions");
  const downloads: string[] = [];
  const result = await readProjectProposalPdf(f.db, async () => actor(), "project", {
    read: async (artifact, authorize) => { downloads.push(artifact.key); await authorize(); return Buffer.from("new"); },
  });
  assert.equal(result?.bytes?.toString(), "new");
  assert.deepEqual(downloads, ["kp/proposals/proposal/exports/second.pdf"]);
});

test("saving, pending and failed exports keep the prior PDF; tie order is deterministic", async () => {
  const f = fixture(); f.publish("published", 1); f.proposal.revision = 9;
  f.publish("pending", 10, "PENDING"); f.publish("failed", 11, "DELETED");
  assert.equal((await projectProposalPdfFile(f.db, actor(), "project"))?.fileName, "КП_published.pdf");
  f.publish("tie-a", 20); f.publish("tie-z", 20);
  assert.equal((await projectProposalPdfFile(f.db, actor(), "project"))?.fileName, "КП_tie-z.pdf");
});

test("outside LEAD only the accepted own READY PDF is exposed, including after retention", async () => {
  const f = fixture(); const accepted = f.publish("accepted", 1); f.publish("newer", 2);
  f.project.stage = "IN_WORK"; f.proposal.acceptedVersionId = accepted.id;
  assert.equal((await projectProposalPdfFile(f.db, actor(), "project"))?.fileName, "КП_accepted.pdf");
  accepted.pdfArtifact.state = "RETIRING";
  assert.equal(await projectProposalPdfFile(f.db, actor(), "project"), null);
});

test("deleted, foreign and unpublished PDF owners are hidden", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.project.deletedAt = new Date(); },
    (f: ReturnType<typeof fixture>) => { f.proposal.deletedAt = new Date(); },
    (f: ReturnType<typeof fixture>) => { (f.versions[0].pdfArtifact as FixtureRow).proposalId = "foreign"; },
    (f: ReturnType<typeof fixture>) => { (f.versions[0].pdfArtifact as FixtureRow).contractId = "contract"; },
    (f: ReturnType<typeof fixture>) => { (f.versions[0].pdfArtifact as FixtureRow).deletedAt = new Date(); },
  ]) {
    const f = fixture(); f.publish("old", 1); mutate(f);
    assert.equal(await projectProposalPdfFile(f.db, actor(), "project"), null);
  }
});

test("GENERAL virtual and ordinary project files share engineer stages and assigned FIELD grants", () => {
  const project: FixtureRow = { id: "project", deletedAt: null, stage: "IN_WORK", products: [], tasks: [] };
  const product: FixtureRow = { id: "product", deletedAt: null, project, status: "PRODUCTION", engineerId: "other", tasks: [], assemblerId: null };
  const task: FixtureRow = { id: "task", deletedAt: null, project, product, productId: "product", assigneeId: "other" };
  project.products = [product]; product.tasks = [task];
  const ordinary: FixtureRow = { id: "file", project, projectId: "project", productId: null, product: null, taskId: null, task: null, section: "GENERAL" };
  for (const roles of [["ENGINEER"], ["WORKER"], ["MOUNTER"], ["ENGINEER", "WORKER"], ["MANAGER"], ["PROCUREMENT"], ["ACCOUNTANT"]] as Role[][]) {
    for (const stage of ["LEAD", "CONTRACT", "IN_WORK", "DONE"])
      for (const assignee of ["reader", "other"]) {
        project.stage = stage; task.assigneeId = assignee;
        assert.equal(matches(project, generalProjectFileVisibilityWhere(actor(roles)) as FixtureRow),
          matches(ordinary, fileVisibilityWhere(actor(roles)) as FixtureRow), `${roles}/${stage}/${assignee}`);
      }
  }
  project.stage = "IN_WORK"; task.assigneeId = "other";
  assert.equal(matches(project, generalProjectFileVisibilityWhere(actor(["ENGINEER"])) as FixtureRow), true);
  project.stage = "LEAD";
  assert.equal(matches(project, generalProjectFileVisibilityWhere(actor(["ENGINEER"])) as FixtureRow), false);
  project.stage = "IN_WORK";
  assert.equal(matches(project, generalProjectFileVisibilityWhere(actor(["WORKER"])) as FixtureRow), false);
  task.assigneeId = "reader";
  assert.equal(matches(project, generalProjectFileVisibilityWhere(actor(["WORKER"])) as FixtureRow), true);
});

test("download rechecks live access and artifact ownership after I/O and never returns stale bytes", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { f.project.deletedAt = new Date(); },
    (f: ReturnType<typeof fixture>) => { (f.versions[0].pdfArtifact as FixtureRow).state = "RETIRING"; },
    (f: ReturnType<typeof fixture>) => { f.publish("new-current", 2); },
  ]) {
    const f = fixture(); f.publish("old", 1);
    await assert.rejects(readProjectProposalPdf(f.db, async () => actor(), "project", {
      read: async (_artifact, authorize) => { await authorize(); mutate(f); await authorize(); return Buffer.from("old"); },
    }), (error: unknown) => error instanceof Error && "status" in error && error.status === 404);
  }
  const f = fixture(); f.publish("old", 1); let allowed = true;
  await assert.rejects(readProjectProposalPdf(f.db, async () => allowed ? actor() : null, "project", {
    read: async (_artifact, authorize) => { allowed = false; await authorize(); return Buffer.from("old"); },
  }), (error: unknown) => error instanceof Error && "status" in error && error.status === 404);
});

test("successful polling targets live source projects only and deduplicates retained or contract releases", async () => {
  const f = fixture();
  f.proposal.isArchive = true;
  assert.deepEqual(await publishedProjectPdfPaths(f.db, []), []);
  assert.deepEqual(await publishedProjectPdfPaths(f.db, ["proposal", "proposal", "foreign"]), ["/projects", "/projects/project"]);
  f.project.deletedAt = new Date();
  assert.deepEqual(await publishedProjectPdfPaths(f.db, ["proposal"]), []);
});
