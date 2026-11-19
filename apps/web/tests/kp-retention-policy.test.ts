import { test } from "node:test";
import assert from "node:assert/strict";
import { RetentionError, makeRetentionManifest, retentionAnniversary, retentionPayload, type RetentionPayload } from "../src/server/kp/retention-contract";
import { planProposalRetention } from "../src/server/kp/retention-policy";
import { acceptedPayload, fact, retentionBinding, retentionSnapshot, retentionTime, technicalCleanup } from "./helpers/kp-retention-fixture";

test("stage changes and yearly retention preserve all published revisions and objects", () => {
  const snapshot = retentionSnapshot();
  for (const stage of ["LEAD", "IN_WORK", "DONE", "PAUSED", "RECLAMATION"]) {
    snapshot.proposal.stage = stage;
    assert.deepEqual(planProposalRetention(snapshot, acceptedPayload, retentionTime).targets, []);
    assert.deepEqual(planProposalRetention(snapshot, acceptedPayload, retentionTime).pruneVersionIds, []);
  }
  snapshot.proposal.createdAt = new Date("2024-02-29T12:00:00Z");
  const expiresAt = retentionAnniversary(snapshot.proposal.createdAt).toISOString();
  assert.equal(expiresAt, "2025-02-28T12:00:00.000Z");
  assert.deepEqual(planProposalRetention(snapshot,
    { schema: 1, kind: "ANNUAL_MEDIA", proposalId: "proposal", expiresAt }, retentionTime).targets, []);
});

test("active renders and copies protect a technical object until the live source releases it", () => {
  for (const kind of ["PDF", "CONTRACT", "COPY_PRODUCT_MEDIA", "UPLOAD_MEDIA"]) {
    const snapshot = retentionSnapshot(), payload = technicalCleanup(snapshot);
    snapshot.jobs.push({ id: "busy", kind, state: "PROCESSING", attempts: 1, maxAttempts: 5,
      leaseUntil: new Date(retentionTime.getTime()+60_000), result: null,
      payload: kind === "PDF" || kind === "CONTRACT" ? { frozenSources: [{ proposalId: "proposal", media: [{ id: "unpublished" }] }] } : { mediaId: "unpublished" } });
    assert.throws(() => planProposalRetention(snapshot, payload, retentionTime), error => error instanceof RetentionError && error.retryable);
    snapshot.jobs[1].leaseUntil = new Date(retentionTime.getTime()-1);
    assert.ok(planProposalRetention(snapshot, payload, retentionTime).targets.length > 0);
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
  assert.equal(planProposalRetention(snapshot, payload, retentionTime).targets.length, 0, "READY без связей остаётся доступным");
  media.uploadState = "PENDING"; snapshot.jobs[0].state = "SUCCEEDED";
  assert.equal(planProposalRetention(snapshot, payload, retentionTime).targets.length, 0, "подтверждённая операция сохраняется");
  snapshot.jobs[0].state = "FAILED";
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
  assert.deepEqual(planProposalRetention(snapshot, payload, retentionTime).targets, []);
  assert.deepEqual(planProposalRetention(snapshot, { ...payload, kind: "UNATTACHED_PRODUCT_COPY", mediaId: "shared" },
    retentionTime).targets, []);

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
  assert.deepEqual(planProposalRetention(snapshot, { schema: 1, kind: "ANNUAL_MEDIA", proposalId: "proposal", expiresAt: "2021-01-01T00:00:00.000Z" }, retentionTime).targets, []);
  snapshot.archiveReservations[0].published = true;
  assert.equal(planProposalRetention(snapshot, orphan, retentionTime).targets.length, 0);
  snapshot.archiveReservations[0].published = false; snapshot.archiveReservations[0].objects[0].sha256 = "f".repeat(64);
  assert.throws(() => planProposalRetention(snapshot, orphan, retentionTime), /FACTS_CHANGED/);
});

test("exact scope rejects path escape, URLs and malformed cleanups", () => {
  const snapshot = retentionSnapshot();
  const target = planProposalRetention(snapshot, technicalCleanup(snapshot), retentionTime).targets[0];
  for (const key of ["kp/proposals/other/exports/a.pdf", "../x", "https://private.invalid/key", "/absolute", "kp/proposals/proposal/original/../x"])
    assert.throws(() => makeRetentionManifest("proposal", [{ ...target, key }], []));
  assert.throws(() => retentionPayload({ schema: 1, kind: "ACCEPTED_RETENTION", proposalId: "proposal", acceptedVersionId: "accepted", retentionEpoch: 2, arbitrary: true }));
});
