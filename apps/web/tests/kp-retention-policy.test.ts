import { test } from "node:test";
import assert from "node:assert/strict";
import { RetentionError, makeRetentionManifest, retentionAnniversary, retentionPayload, type RetentionPayload } from "../src/server/kp/retention-contract";
import { planProposalRetention,shouldScheduleAcceptanceCleanup } from "../src/server/kp/retention-policy";
import { acceptedPayload, fact, retentionBinding, retentionSnapshot, retentionTime } from "./helpers/kp-retention-fixture";

test("IN_WORK retains accepted PDF/shared optimized media and independent issued contract", () => {
  const snapshot = retentionSnapshot(), plan = planProposalRetention(snapshot, acceptedPayload, retentionTime);
  assert.deepEqual(plan.pruneVersionIds, ["old"]);
  assert.deepEqual(plan.targets.filter(target => target.entity === "MEDIA").map(target => `${target.entityId}:${target.variant}`).sort(),
    ["current:original", "old-only:optimized", "old-only:original", "shared:original"]);
  assert.deepEqual(plan.targets.filter(target => target.entity === "ARTIFACT").map(target => target.entityId), ["pdf-old"]);
  assert.ok(!plan.targets.some(target => target.key.includes("contracts/") || target.entityId === "pdf-kept"));
});

test("year expiry is from original creation including old archives and Feb29 anniversary", () => {
  const snapshot = retentionSnapshot(); snapshot.proposal.createdAt = new Date("2024-02-29T12:00:00Z");
  snapshot.proposal.projectId = null; snapshot.proposal.stage = null;
  const expiry = retentionAnniversary(snapshot.proposal.createdAt).toISOString();
  assert.equal(expiry, "2025-02-28T12:00:00.000Z");
  const payload: RetentionPayload = { schema: 1, kind: "ANNUAL_MEDIA", proposalId: "proposal", expiresAt: expiry };
  assert.throws(() => planProposalRetention(snapshot, payload, new Date("2025-02-28T11:59:59Z")), /NOT_DUE/);
  const plan = planProposalRetention(snapshot, payload, new Date(expiry));
  assert.equal(plan.targets.length, 6); assert.ok(plan.targets.every(target => target.entity === "MEDIA"));
  assert.deepEqual(plan.pruneVersionIds, []);
});

test("epoch/stage/accepted mismatch cancels old acceptance policy", () => {
  for (const key of ["stage", "epoch", "acceptedVersionId"] as const) {
    const snapshot = retentionSnapshot();
    if (key === "stage") snapshot.proposal.stage = "LEAD";
    if (key === "epoch") snapshot.proposal.epoch++;
    if (key === "acceptedVersionId") snapshot.proposal.acceptedVersionId = "another";
    assert.throws(() => planProposalRetention(snapshot, acceptedPayload, retentionTime), /CANCELLED/);
  }
});

test('queued IN_WORK retention still runs after DONE/PAUSED/RECLAMATION with same acceptance',()=>{
  for(const stage of['DONE','PAUSED','RECLAMATION']){
    const snapshot=retentionSnapshot();snapshot.proposal.stage=stage;
    assert.equal(shouldScheduleAcceptanceCleanup(snapshot),true);
    const manifest=planProposalRetention(snapshot,acceptedPayload,retentionTime);
    assert.ok(manifest.targets.length>0);assert.deepEqual(manifest.pruneVersionIds,['old']);
  }
  const beforeInWork=retentionSnapshot();beforeInWork.proposal.stage='CONTRACT';beforeInWork.inWorkTriggered=false;
  assert.equal(shouldScheduleAcceptanceCleanup(beforeInWork),false);
  beforeInWork.inWorkTriggered=true;assert.equal(shouldScheduleAcceptanceCleanup(beforeInWork),true);
  beforeInWork.proposal.stage='LEAD';assert.equal(shouldScheduleAcceptanceCleanup(beforeInWork),false);
});

test("active PDF/CONTRACT frozen sources and source-copy leases protect physical cleanup", () => {
  for (const kind of ["PDF", "CONTRACT", "COPY_PRODUCT_MEDIA", "UPLOAD_MEDIA"]) {
    const snapshot = retentionSnapshot(); snapshot.jobs.push({ id: "busy", kind, state: "PROCESSING", attempts: 1, maxAttempts: 5,
      leaseUntil: new Date(retentionTime.getTime()+60_000), result: null,
      payload: kind === "PDF" || kind === "CONTRACT" ? { frozenSources: [{ proposalId: "proposal", media: [{ id: "shared" }] }] } : { mediaId: "shared" } });
    assert.throws(() => planProposalRetention(snapshot, acceptedPayload, retentionTime), error => error instanceof RetentionError && error.retryable);
    snapshot.jobs[0].leaseUntil = new Date(retentionTime.getTime()-1);
    assert.ok(planProposalRetention(snapshot, acceptedPayload, retentionTime).targets.length > 0);
  }
});

test("unattached images protect every current/issued reference and reject forged object facts", () => {
  const snapshot = retentionSnapshot(), media = snapshot.media[0];
  media.uploadJobId='upload';snapshot.jobs.push({id:'upload',kind:'UPLOAD_MEDIA',state:'FAILED',attempts:1,maxAttempts:5,leaseUntil:null,result:null,
    payload:{proposalId:'proposal',mediaId:media.id,binding:media.binding,original:media.original,optimized:media.optimized}});
  const payload: RetentionPayload = { schema: 1, kind: "UNATTACHED_MEDIA", proposalId: "proposal", mediaId: media.id,
    projectId: "project", operationJobId: "upload", binding: media.binding, objects: [media.original!, media.optimized!] };
  assert.equal(planProposalRetention(snapshot, payload, retentionTime).targets.length, 0);
  snapshot.currentMediaIds = []; snapshot.versions = [];
  assert.equal(planProposalRetention(snapshot, payload, retentionTime).targets.length, 2);
  assert.throws(() => planProposalRetention(snapshot, { ...payload, objects: [{ ...media.optimized!, sha256: "a".repeat(64) }] }, retentionTime), /FACTS_CHANGED/);
});

test("retired copies require exact source ledger, absence of covers aliases and pending ordinary deletes", () => {
  const snapshot = retentionSnapshot(), key = "project/kp-11111111-1111-4111-8111-111111111111.jpg", object = fact(key);
  snapshot.jobs.push({ id: "copy-job", kind: "COPY_PRODUCT_MEDIA", state: "SUCCEEDED", attempts: 1, maxAttempts: 5, leaseUntil: null, result: null,
    payload: { fileId: "file", projectId: "project", proposalId: "proposal",itemId:'item',mediaId:'shared', storedName: key.split("/")[1], binding: retentionBinding, optimized: object } });
  snapshot.files.push({ id: "file", projectId: "project", productId: "product", storedName: key.split("/")[1], fileName: "image.jpg", uploadedById: "manager", hasThumb: false,
    retiredAt: retentionTime, sourceItemId: "item", sourceMediaId: "shared", copyJobId: "copy-job", coverReferences: 0, aliases: 0, pendingDelete: false });
  const payload: RetentionPayload = { schema: 1, kind: "RETIRED_PRODUCT_COPY", proposalId: "proposal", sourceMediaId: "shared", projectId: "project", fileId: "file",
    storedName: key.split("/")[1], operationJobId: "copy-job", binding: retentionBinding, objects: [object] };
  assert.deepEqual(planProposalRetention(snapshot, payload, retentionTime).targets.map(target => target.key), [key]);
  for (const field of ["coverReferences", "aliases", "pendingDelete"] as const) {
    const row = snapshot.files[0]; if (field === "pendingDelete") row.pendingDelete = true; else row[field] = 1;
    assert.throws(() => planProposalRetention(snapshot, payload, retentionTime), /REFERENCED/);
    row.coverReferences = 0; row.aliases = 0; row.pendingDelete = false;
  }
  snapshot.pendingFileKeys = [key]; snapshot.files = [];
  assert.throws(() => planProposalRetention(snapshot, payload, retentionTime), /REFERENCED/);
});

test("unused failed PDF/DOCX artifacts use authoritative attempt-key and issued history is preserved", () => {
  for (const kind of ["PDF", "DOCX"]) {
    const snapshot = retentionSnapshot(), artifact = snapshot.artifacts.find(value => value.kind === kind)!;
    artifact.id = "orphan"; artifact.state = "PENDING"; artifact.quoteVersionIds = []; artifact.contractVersionIds = [];
    const root = kind === "PDF" ? "proposals/proposal" : "contracts/contract";
    artifact.object = fact(`kp/${root}/exports/render-1-orphan.${kind === "PDF" ? "pdf" : "docx"}`);
    snapshot.jobs.push({ id: "render", kind: kind === "PDF" ? "PDF" : "CONTRACT", state: "FAILED", attempts: 1, maxAttempts: 5, leaseUntil: null, payload: {}, result: null });
    const payload: RetentionPayload = { schema: 1, kind: "ORPHAN_ARTIFACT", proposalId: "proposal", artifactId: "orphan", operationJobId: "render", attempt: 1,
      binding: retentionBinding, objects: [artifact.object] };
    assert.equal(planProposalRetention(snapshot, payload, retentionTime).targets.length, 1);
    artifact.state = "READY"; artifact.contractVersionIds = ["issued"];
    assert.equal(planProposalRetention(snapshot, payload, retentionTime).targets.length, 0);
  }
});

test("pending archive blocks annual purge; its exact orphan artifact requires unpublished reserve/quarantine", () => {
  const snapshot = retentionSnapshot(), artifact = snapshot.artifacts[2], manifestHash = "a".repeat(64);
  snapshot.proposal.createdAt = new Date("2020-01-01T00:00:00Z"); artifact.state = "PENDING"; artifact.contractVersionIds = [];
  snapshot.jobs.push({ id: "archive-upload", kind: "UPLOAD_MEDIA", state: "FAILED", attempts: 1, maxAttempts: 5, leaseUntil: null,
    payload: {proposalId:'proposal',artifactId:artifact.id,contractId:artifact.contractId,archiveImport:{manifestHash}}, result: null });
  snapshot.archiveReservations.push({ id: "kp.archive.reserve:"+manifestHash, manifestHash, published: false, createdAt: new Date("2026-10-10T00:00:00Z"),
    objects: [{ id: "object", proposalId: "proposal", artifactId: artifact.id, operationJobId: "archive-upload", binding: retentionBinding, ...artifact.object }] });
  const orphan: RetentionPayload = { schema: 1, kind: "ORPHAN_ARCHIVE_ARTIFACT", proposalId: "proposal", artifactId: artifact.id, operationJobId: "archive-upload",
    archiveReserveReceiptId: "kp.archive.reserve:"+manifestHash, archiveManifestHash: manifestHash, binding: retentionBinding, objects: [artifact.object] };
  assert.equal(planProposalRetention(snapshot, orphan, retentionTime).targets.length, 1);
  assert.throws(() => planProposalRetention(snapshot, { schema: 1, kind: "ANNUAL_MEDIA", proposalId: "proposal", expiresAt: "2021-01-01T00:00:00.000Z" }, retentionTime), /REFERENCED/);
  snapshot.archiveReservations[0].published = true;
  assert.equal(planProposalRetention(snapshot, orphan, retentionTime).targets.length, 0);
  snapshot.archiveReservations[0].published = false; snapshot.archiveReservations[0].objects[0].sha256 = "f".repeat(64);
  assert.throws(() => planProposalRetention(snapshot, orphan, retentionTime), /FACTS_CHANGED/);
});

test("exact scope rejects path escape, URLs and malformed cleanups", () => {
  const target = planProposalRetention(retentionSnapshot(), acceptedPayload, retentionTime).targets[0];
  for (const key of ["kp/proposals/other/exports/a.pdf", "../x", "https://private.invalid/key", "/absolute", "kp/proposals/proposal/original/../x"])
    assert.throws(() => makeRetentionManifest("proposal", [{ ...target, key }], []));
  assert.throws(() => retentionPayload({ schema: 1, kind: "ACCEPTED_RETENTION", proposalId: "proposal", acceptedVersionId: "accepted", retentionEpoch: 2, arbitrary: true }));
});
