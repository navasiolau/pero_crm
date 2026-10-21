import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { applyProposalStageGate, publishSourcePdf, readVersionPdf, recordPendingPdfArtifact, requestProposalPdf, restoreProposalVersion } from "../src/server/kp/lifecycle";
import { ProposalLifecycleError, parseRenderJobPayload } from "../src/server/kp/lifecycle-contract";
import { createPdfRenderHandler, createRenderWorker } from "../src/server/kp/render-worker";
import { lifecycleFixture } from "./helpers/kp-lifecycle-fixture";
import { proposalArtifactFileName } from "../src/server/kp/pdf-filename";

const enabled = () => ({ PERO_KP_ENABLED: "1", PERO_KP_WORKER_ENABLED: "1" });
const isCode = (code: string) => (error: unknown) => error instanceof ProposalLifecycleError && error.code === code;
async function request(f: ReturnType<typeof lifecycleFixture>, operationId = randomUUID()) {
  return f.transaction(store => requestProposalPdf(store, f.binding, { proposalId: f.state.proposal.id, expectedRevision: f.state.proposal.revision, operationId }, f.ports));
}
async function release(f: ReturnType<typeof lifecycleFixture>) {
  const job = await request(f); assert.equal(job.kind, "job");
  const worker = createRenderWorker({ queue: f.queue, handlers: { PDF: createPdfRenderHandler({ transaction: f.transaction, ports: f.ports, io: f.io }) }, environment: enabled });
  assert.equal(await worker.runOne(), "succeeded");
  return [...f.state.versions.values()][0];
}

test("request freezes DB source and Decimal strings; exact receipt replay survives stage change", async () => {
  const f = lifecycleFixture(), operationId = randomUUID();
  const first = await request(f, operationId); assert.equal(first.kind, "job");
  const saved = parseRenderJobPayload([...f.state.jobs.values()][0].payload);
  f.state.proposal.state.items[0].title = "После изменения";
  f.state.clients.get("client1")!.name = "Новое имя CRM";
  f.state.project.stage = "CONTRACT";
  const repeated = await f.transaction(store => requestProposalPdf(store, f.binding, { proposalId: "proposal1", expectedRevision: 1, operationId }, f.ports));
  assert.equal(repeated.kind, "job"); assert.equal(repeated.replayed, true); assert.equal(f.state.jobs.size, 1);
  assert.equal(saved.frozenSources[0].state.items[0].title, "До изменения");
  assert.equal(saved.frozenSources[0].binding.clientSnapshot.name, "Клиент А");
  assert.equal(saved.frozenSources[0].rate, "3.2500000000");
  assert.equal(saved.frozenSources[0].pricingSnapshot.totalAfterDiscount, "222.21");
  await assert.rejects(f.transaction(store => requestProposalPdf(store, { ...f.binding, id: "manager2" }, { proposalId: "proposal1", expectedRevision: 1, operationId }, f.ports)), isCode("KP_OPERATION_REUSED"));
  await assert.rejects(f.transaction(store => requestProposalPdf(store, f.binding, { proposalId: "proposal1", expectedRevision: 2, operationId }, f.ports)), isCode("KP_OPERATION_REUSED"));
});

test("caller raw state, disabled module and current role revocation reject before job writes", async () => {
  const f = lifecycleFixture();
  await assert.rejects(f.transaction(store => requestProposalPdf(store, f.binding, { proposalId: "proposal1", expectedRevision: 1, operationId: randomUUID(), state: { items: [] } }, f.ports)), isCode("KP_PDF_REQUEST_INVALID"));
  await assert.rejects(f.transaction(store => requestProposalPdf(store, f.binding, { proposalId: "proposal1", expectedRevision: 1, operationId: randomUUID() }, { ...f.ports, enabled: false })), isCode("KP_DISABLED"));
  f.state.users.get("manager1")!.roles = ["ACCOUNTANT"];
  await assert.rejects(request(f), isCode("KP_FORBIDDEN"));
  assert.equal(f.state.jobs.size, 0);
});

test("PDF worker persists PENDING before upload then publishes one immutable linked release atomically", async () => {
  const f = lifecycleFixture(), upload = f.io.upload;
  f.state.proposal.state.order = { number: "222" };
  f.io.upload = async (artifact, bytes, signal) => { assert.equal(f.state.artifacts.get(artifact.id)?.state, "PENDING"); assert.equal(f.state.versions.size, 0); assert.ok(f.state.orphans.some(intent => intent.artifactId === artifact.id && intent.attempt === 1)); return upload(artifact, bytes, signal); };
  const version = await release(f);
  assert.equal(f.state.versions.size, 1); assert.equal(f.state.artifacts.get(version.pdfArtifactId!)?.state, "READY");
  const artifact = f.state.artifacts.get(version.pdfArtifactId!)!;
  assert.equal(artifact.fileName, "КП_222.pdf");
  f.state.proposal.state.order = { number: "999" };
  const reader = { proposalVersion: { findFirst: async (query: unknown) => {
    assert.deepEqual(query, { where: { proposalId: artifact.proposalId, pdfArtifactId: artifact.id }, orderBy: { createdAt: "desc" }, select: { state: true } });
    return { state: version.state };
  } } } as unknown as Parameters<typeof proposalArtifactFileName>[0];
  assert.equal(await proposalArtifactFileName(reader, { ...artifact, fileName: "old-internal-id.pdf" }), "КП_222.pdf");
  assert.deepEqual(f.state.versionMedia.get(version.id), ["media1"]);
  assert.equal([...f.state.jobs.values()][0].state, "SUCCEEDED");
  assert.ok(f.state.authorizations >= 7);
});

test("revision race and token revocation during renderer prevent publication and upload", async () => {
  for (const race of ["revision", "token"] as const) {
    const f = lifecycleFixture(), render = f.io.render;
    f.io.render = async (input, signal) => { const result = await render(input, signal); if (race === "revision") f.state.proposal.revision++; else f.state.revoked = true; return result; };
    await request(f);
    const worker = createRenderWorker({ queue: f.queue, handlers: { PDF: createPdfRenderHandler({ transaction: f.transaction, ports: f.ports, io: f.io }) }, environment: enabled });
    assert.equal(await worker.runOne(), "failed");
    assert.equal(f.state.versions.size, 0); assert.equal(f.state.artifacts.size, 0); assert.equal(f.uploaded.size, 0);
    assert.equal([...f.state.jobs.values()][0].state, "CANCELLED");
  }
});

test("readback mismatch and last SQL write failure leave pending ledger without partial READY version", async () => {
  for (const failure of ["readback", "last-write"] as const) {
    const f = lifecycleFixture(), verify = f.io.verify;
    if (failure === "readback") f.io.verify = async (artifact, signal) => ({ ...await verify(artifact, signal), sha256: "0".repeat(64) });
    else f.state.failLink = true;
    await request(f);
    const worker = createRenderWorker({ queue: f.queue, handlers: { PDF: createPdfRenderHandler({ transaction: f.transaction, ports: f.ports, io: f.io }) }, environment: enabled });
    assert.equal(await worker.runOne(), "failed");
    assert.equal(f.state.versions.size, 0); assert.equal(f.state.artifacts.size, 1);
    assert.equal([...f.state.artifacts.values()][0].state, "PENDING");
    assert.equal([...f.state.jobs.values()][0].state === "SUCCEEDED", false);
  }
});

test("lost lease after upload cannot complete or modify the replacement worker", async () => {
  const f = lifecycleFixture(), upload = f.io.upload;
  f.io.upload = async (artifact, bytes, signal) => {
    await upload(artifact, bytes, signal);
    const job = [...f.state.jobs.values()][0]; job.leaseOwner = "replacement"; job.attempts++;
  };
  await request(f);
  const worker = createRenderWorker({ queue: f.queue, handlers: { PDF: createPdfRenderHandler({ transaction: f.transaction, ports: f.ports, io: f.io }) }, environment: enabled });
  assert.equal(await worker.runOne(), "failed");
  const job = [...f.state.jobs.values()][0]; assert.equal(job.leaseOwner, "replacement"); assert.equal(job.state, "PROCESSING");
  assert.equal(f.state.failures.length, 0); assert.equal(f.state.versions.size, 0);
});

test("a pending artifact from an older attempt cannot be attached to the new claim", async () => {
  const f = lifecycleFixture(); await request(f);
  const first = await f.queue.claim(["PDF"], "first", 60000); assert.ok(first);
  const artifact = await f.transaction(store => recordPendingPdfArtifact(store, first, "proposal1", { storageBinding: f.io.storageBinding(), sha256: "a".repeat(64), size: 10 }, f.ports));
  const job = f.state.jobs.get(first.id)!; job.leaseOwner = "second"; job.attempts++;
  const next = { ...first, owner: "second", attempt: job.attempts };
  await assert.rejects(f.transaction(store => publishSourcePdf(store, { claim: next, proposalId: "proposal1", artifactId: artifact.id, verified: artifact }, f.ports)), isCode("KP_ARTIFACT_VERIFICATION_FAILED"));
  assert.equal(f.state.versions.size, 0); assert.equal(f.state.artifacts.get(artifact.id)?.state, "PENDING");
});

test("stage gate requires current release even with module off; acceptance, prune and Lead return preserve history", async () => {
  const f = lifecycleFixture(), gate = { projectId: "project1", fromStage: "LEAD" as const, toStage: "IN_WORK" as const, at: f.state.now };
  f.ports.enabled = false;
  await assert.rejects(f.transaction(store => applyProposalStageGate(store, gate)), isCode("KP_RELEASE_REQUIRED"));
  assert.equal(f.state.proposal.acceptedVersionId, null); assert.equal(f.state.cleanup.length, 0);
  f.ports.enabled = true; const version = await release(f); f.ports.enabled = false;
  await f.transaction(store => applyProposalStageGate(store, gate));
  assert.equal(f.state.proposal.acceptedVersionId, version.id); assert.equal(f.state.proposal.retentionEpoch, 1); assert.ok(f.state.acceptedAt);
  assert.deepEqual(f.state.cleanup.map(row => [row.versionId, row.epoch, row.state]), [[version.id, 1, "PENDING"]]);
  await f.transaction(store => applyProposalStageGate(store, { ...gate, fromStage: "IN_WORK", toStage: "LEAD" }));
  assert.equal(f.state.proposal.acceptedVersionId, null); assert.equal(f.state.acceptedAt, null); assert.equal(f.state.proposal.retentionEpoch, 2);
  assert.equal(f.state.cleanup[0].state, "CANCELLED"); assert.equal(f.state.versions.size, 1);
});

test("frozen download UUID remains bound to its accepted PDF after return to Lead", async () => {
  const f = lifecycleFixture(), version = await release(f), operationId = randomUUID();
  f.state.project.stage = "CONTRACT"; f.state.proposal.acceptedVersionId = version.id;
  const first = await request(f, operationId); assert.equal(first.kind, "retained");
  f.state.project.stage = "LEAD"; f.state.proposal.acceptedVersionId = null;
  const replay = await request(f, operationId); assert.equal(replay.kind, "retained"); assert.equal(replay.replayed, true); assert.equal(f.state.jobs.size, 1);
  f.state.proposal.revision++;
  await assert.rejects(request(f, operationId), isCode("KP_OPERATION_REUSED"));
});

test("restore delegates historical binding, full state and fixed FX; expired images give410 while frozen PDF still downloads", async () => {
  const f = lifecycleFixture(), version = await release(f), historicState = structuredClone(version.state);
  f.state.proposal.clientId = "client2"; f.state.proposal.revision = 2; f.state.proposal.state.items[0].title = "Текущая версия";
  let calls = 0;
  const command = { proposalId: "proposal1", versionId: version.id, expectedRevision: 2, operationId: randomUUID() };
  const save = async (_actor: unknown, input: Parameters<import("../src/server/kp/lifecycle").RestoreSave>[1]) => {
    calls++; assert.equal(input.clientId, "client1"); assert.deepEqual(input.state, historicState); assert.equal(input.fx.rate, "3.2500000000");
    f.state.proposal.revision++; f.state.proposal.clientId = input.clientId; f.state.proposal.state = structuredClone(input.state);
    return { revision: f.state.proposal.revision };
  };
  const restored = await f.transaction(store => restoreProposalVersion(store, f.binding, command, f.ports, save));
  assert.equal(restored.revision, 3); assert.equal(calls, 1); assert.deepEqual(f.state.versions.get(version.id)?.state, historicState);
  f.state.project.stage = "CONTRACT";
  assert.equal((await f.transaction(store => restoreProposalVersion(store, f.binding, command, f.ports, save))).replayed, true); assert.equal(calls, 1);
  f.state.proposal.acceptedVersionId = version.id;
  f.state.now = new Date("2028-01-01T00:00:00Z");
  const download = await f.transaction(store => readVersionPdf(store, f.binding, "proposal1", version.id)); assert.equal(download.artifact.id, version.pdfArtifactId);
  const reused = await request(f); assert.equal(reused.kind, "retained"); assert.equal(f.state.jobs.size, 1);
  f.state.project.stage = "LEAD";
  await assert.rejects(f.transaction(store => restoreProposalVersion(store, f.binding, { ...command, expectedRevision: 3, operationId: randomUUID() }, f.ports, save)), error => error instanceof ProposalLifecycleError && error.status === 410);
  assert.equal(calls, 1); assert.equal(f.state.proposal.revision, 3);
});

test("release and restore keep the saved quote customer after independent CRM edits", async () => {
  const f = lifecycleFixture();
  f.state.proposal.state.client = { name: "A", contact: "X", crmId: "client1", crmSnapshot: { id: "client1", name: "A", phone: "X" } };
  f.state.clients.set("client1", { name: "B", phone: "Y" });
  const version = await release(f);
  assert.deepEqual((version.renderSnapshot.binding as { clientSnapshot: unknown }).clientSnapshot, { name: "A", phone: "X" });
  f.state.proposal.revision = 2;
  f.state.proposal.state.client = { name: "Изменённое КП", crmId: "client1", crmSnapshot: { id: "client1", name: "Изменённое КП", phone: "Z" } };
  await f.transaction(store => restoreProposalVersion(store, f.binding, { proposalId: "proposal1", versionId: version.id, expectedRevision: 2, operationId: randomUUID() }, f.ports,
    async (_actor, input) => {
      assert.deepEqual(input.state.client, version.state.client);
      assert.equal(Object.hasOwn(input, "clientSnapshot"), false);
      return { revision: 3 };
    }));
});

test("a temporary customer version restores without trying to edit the service card", async () => {
  const f = lifecycleFixture();
  f.state.proposal.clientId = "temporary";
  f.state.proposal.state.client = { crmId: "temporary", crmSnapshot: { id: "temporary", name: "Временный", phone: "" } };
  f.state.clients.set("temporary", { name: "Временный", phone: "" });
  const version = await release(f);
  const result = await f.transaction(store => restoreProposalVersion(store, f.binding, { proposalId: "proposal1", versionId: version.id, expectedRevision: 1, operationId: randomUUID() }, f.ports,
    async (_actor, input) => {
      assert.equal(input.clientId, "temporary");
      assert.equal(Object.hasOwn(input, "clientSnapshot"), false, "№181 rejects every explicit service-card snapshot");
      assert.deepEqual(input.state.client, version.state.client);
      return { revision: 2 };
    }));
  assert.equal(result.revision, 2);
});
