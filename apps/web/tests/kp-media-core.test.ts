import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { ProposalMediaError, mediaSha256, type MediaBinding, type MediaPlan, type MediaReadRequest,
  type MediaReservation, type ReadableMedia } from "../src/server/kp/media-contract";
import { createMediaUploadPlan, createProductMediaCopyPlan, prepareProposalProductMedia, readProposalMedia, uploadProposalImage,
  type MediaCopyRequest, type MediaUploadRequest, type ProposalMediaRepository } from "../src/server/kp/media-core";
import type { ProposalMediaStorage } from "../src/server/kp/media-storage";
import { proposalMediaPreviewUrl, resolveProposalMediaAssets } from "../src/server/kp/media-assets";

const binding: MediaBinding = { endpoint: "https://private.invalid/", bucket: "crm-unit", region: "us-east-1" };
const owner = { proposalId: "proposal-a", projectId: "project-a", revision: 4, createdAt: new Date("2026-10-18T12:00:00Z") };
type PublishedMedia = Pick<MediaPlan, "mediaId" | "proposalId" | "original" | "optimized" | "fileName" | "width" | "height">;
function fixture() {
  const objects = new Map<string, Buffer>(), jobs = new Map<string, MediaReservation>(), cleanup = new Map<string, string[]>();
  const published = new Map<string, PublishedMedia>(); const log: string[] = [];
  let writable = true, live = true, revision = owner.revision, existingFileId: string | null = null;
  const authorize = (request: { proposalId: string; expectedRevision?: number }) => {
    if (!live) throw new ProposalMediaError("KP_MEDIA_FORBIDDEN");
    if (request.proposalId !== owner.proposalId) throw new ProposalMediaError("KP_MEDIA_NOT_FOUND");
    if (request.expectedRevision !== undefined && !writable) throw new ProposalMediaError("KP_MEDIA_LOCKED");
    if (request.expectedRevision !== undefined && request.expectedRevision !== revision) throw new ProposalMediaError("KP_MEDIA_REVISION_CONFLICT");
  };
  const repository: ProposalMediaRepository = {
    async reserveUpload(input: MediaUploadRequest) {
      authorize(input); const dedupe = `upload:${input.operationId}`, previous = jobs.get(dedupe);
      if (previous) return { ...previous, repeated: true, ready: published.has(previous.plan.mediaId) };
      const plan = createMediaUploadPlan(owner, input), reservation = { plan, leaseOwner: randomUUID(), repeated: false, ready: false };
      log.push("reserve-upload"); jobs.set(dedupe, reservation);
      cleanup.set(plan.cleanupJobId, [plan.original!.key, plan.optimized.key]); return reservation;
    },
    async reserveCopy(input: MediaCopyRequest) {
      authorize(input); if (existingFileId) return { existingFileId };
      const media = published.get(input.mediaId);
      if (!media || media.proposalId !== input.proposalId) throw new ProposalMediaError("KP_MEDIA_NOT_FOUND");
      const plan = createProductMediaCopyPlan(owner, input, { binding, object: media.optimized, fileName: media.fileName,
        width: media.width, height: media.height });
      log.push("reserve-copy"); cleanup.set(plan.cleanupJobId, [plan.optimized.key]);
      const reservation = { plan, leaseOwner: randomUUID(), repeated: false, ready: false };
      jobs.set(plan.jobId, reservation); return reservation;
    },
    async assertActive(reservation) { authorize(reservation.plan); log.push("check-active"); },
    async publishUpload(reservation) { authorize(reservation.plan); log.push("publish"); published.set(reservation.plan.mediaId, reservation.plan); },
    async completeCopy(reservation) { authorize(reservation.plan); log.push("copy-ready"); jobs.get(reservation.plan.jobId)!.ready = true; },
    async fail() { log.push("failed"); },
    async authorizeRead(input: MediaReadRequest): Promise<ReadableMedia> {
      authorize(input); const plan = published.get(input.mediaId);
      if (!plan || plan.proposalId !== input.proposalId) throw new ProposalMediaError("KP_MEDIA_NOT_FOUND");
      const object = input.variant === "original" ? plan.original : plan.optimized;
      if (!object) throw new ProposalMediaError("KP_MEDIA_NOT_FOUND");
      log.push("read-authorize"); return { binding, object, fileName: plan.fileName };
    },
  };
  const storage: ProposalMediaStorage = {
    currentBinding: () => binding,
    async putIfAbsent(_binding, object, bytes) {
      assert.ok(cleanup.size > 0, "durable cleanup must exist before first S3 write");
      log.push("put:" + object.key); if (objects.has(object.key)) throw Error("PreconditionFailed");
      objects.set(object.key, Buffer.from(bytes));
    },
    async read(_binding, object) { log.push("get:" + object.key); return objects.get(object.key) ?? null; },
  };
  const operation = { actorId: "manager-a", proposalId: owner.proposalId, expectedRevision: owner.revision, operationId: randomUUID() };
  return { dependencies: { repository, storage }, operation, objects, jobs, cleanup, published, log,
    setWritable: (value: boolean) => { writable = value; }, setLive: (value: boolean) => { live = value; },
    setRevision: (value: number) => { revision = value; }, setExistingFile: (value: string) => { existingFileId = value; } };
}
const image = () => sharp({ create: { width: 20, height: 10, channels: 3, background: "orange" } }).png().toBuffer();

test("upload reserves exact cleanup keys before I/O and publishes only after two verified objects", async () => {
  const f = fixture(), original = await image();
  const result = await uploadProposalImage(f.dependencies, { ...f.operation, original, fileName: "original.png" });
  assert.equal(result.reference, "kp-media:" + result.mediaId);
  assert.equal(f.log[0], "reserve-upload"); assert.equal(f.log.at(-1), "publish");
  const plan = f.published.get(result.mediaId)!;
  assert.deepEqual(f.objects.get(plan.original!.key), original);
  assert.equal(mediaSha256(f.objects.get(plan.optimized.key)!), plan.optimized.sha256);
  const before = f.log.filter(entry => entry.startsWith("put:")).length;
  const repeated = await uploadProposalImage(f.dependencies, { ...f.operation, original, fileName: "original.png" });
  assert.equal(repeated.mediaId, result.mediaId); assert.equal(repeated.repeated, true);
  assert.equal(f.log.filter(entry => entry.startsWith("put:")).length, before);
});

test("partial upload leaves no ready media and durable exact cleanup still owns original", async () => {
  const f = fixture(), put = f.dependencies.storage.putIfAbsent;
  f.dependencies.storage.putIfAbsent = async (target, object, bytes) => {
    if (object.key.includes("/optimized/")) throw Error("synthetic storage failed with private endpoint");
    return put(target, object, bytes);
  };
  await assert.rejects(uploadProposalImage(f.dependencies, { ...f.operation, original: await image(), fileName: "x.png" }),
    error => error instanceof ProposalMediaError && error.code === "KP_MEDIA_STORAGE_FAILED" && !error.message.includes("endpoint"));
  assert.equal(f.published.size, 0); assert.equal(f.objects.size, 1);
  assert.ok([...f.cleanup.values()].flat().includes([...f.objects.keys()][0]));
  assert.equal(f.log.at(-1), "failed");
});

test("stage/revision/user/key revocation during I/O prevents publishing", async () => {
  for (const change of ["stage", "revision", "user", "key"]) {
    const f = fixture(), put = f.dependencies.storage.putIfAbsent; let keyLive = true;
    const dependencies = { ...f.dependencies, authorize: async () => { if (!keyLive) throw new ProposalMediaError("KP_MEDIA_FORBIDDEN"); } };
    dependencies.storage.putIfAbsent = async (target, object, bytes) => {
      await put(target, object, bytes);
      if (change === "stage") f.setWritable(false);
      if (change === "revision") f.setRevision(99);
      if (change === "user") f.setLive(false);
      if (change === "key") keyLive = false;
    };
    await assert.rejects(uploadProposalImage(dependencies, { ...f.operation, original: await image(), fileName: "x.png" }), ProposalMediaError);
    assert.equal(f.published.size, 0); assert.equal(f.objects.size, 1);
  }
});

test("Product copies have independent keys and ready receipt before File attachment; unchanged managed copy is reused", async () => {
  const f = fixture(); const uploaded = await uploadProposalImage(f.dependencies, { ...f.operation, original: await image(), fileName: "x.png" });
  const prepared = await prepareProposalProductMedia(f.dependencies, { ...f.operation, operationId: randomUUID(),
    items: [{ id: "item-a", image: uploaded.reference, image2: uploaded.reference }] });
  assert.equal(prepared.jobs.length, 1);
  const copy = f.jobs.get(prepared.jobs[0])!.plan, source = f.published.get(uploaded.mediaId)!;
  assert.ok(copy.optimized.key.startsWith("project-a/kp-")); assert.ok(!copy.optimized.key.startsWith("kp/"));
  assert.notEqual(copy.optimized.key, source.optimized.key);
  assert.deepEqual(f.objects.get(copy.optimized.key), f.objects.get(source.optimized.key));
  f.objects.delete(source.original!.key); f.objects.delete(source.optimized.key);
  assert.ok(f.objects.has(copy.optimized.key));
  f.setExistingFile(copy.fileId!);
  const reused = await prepareProposalProductMedia(f.dependencies, { ...f.operation, operationId: randomUUID(), items: [{ id: "item-a", image: uploaded.reference }] });
  assert.deepEqual(reused.jobs, []);
});

test("imported optimized media prepares an independent copy while source namespace, hash and MIME stay exact", async () => {
  const f = fixture(), bytes = await image(), hash = mediaSha256(bytes), mediaId = "kp_a_m_" + "a".repeat(64);
  const prefix = `kp/proposals/${owner.proposalId}/optimized/`;
  const source = { key: `${prefix}${mediaId}_${hash}.png`, sha256: hash, size: bytes.length, mimeType: "image/png" as const };
  const media: PublishedMedia = { proposalId: owner.proposalId, mediaId, optimized: source, fileName: "import.png", width: 1, height: 1 };
  f.published.set(mediaId, media); f.objects.set(source.key, bytes);
  const preview = await readProposalMedia(f.dependencies, { actorId: f.operation.actorId, proposalId: owner.proposalId,
    mediaId, variant: "optimized", scope: { kind: "current" } });
  assert.deepEqual(preview.bytes, bytes);
  const prepare = () => prepareProposalProductMedia(f.dependencies, { ...f.operation, operationId: randomUUID(),
    items: [{ id: "item-a", image: "kp-media:" + mediaId }] });
  const prepared = await prepare();
  assert.equal(prepared.jobs.length, 1);
  const reservation = f.jobs.get(prepared.jobs[0])!;
  assert.equal(reservation.ready, true);
  assert.deepEqual(reservation.plan.source, source);
  assert.notEqual(reservation.plan.optimized.key, source.key);
  assert.deepEqual(f.objects.get(reservation.plan.optimized.key), bytes);
  assert.deepEqual(f.objects.get(source.key), bytes);
  for (const invalid of [
    { ...source, key: `kp/proposals/other/optimized/${mediaId}_${hash}.png` },
    { ...source, key: `${prefix}other_${hash}.png` },
    { ...source, key: `${prefix}${mediaId}_${"b".repeat(64)}.png` },
    { ...source, key: `${prefix}${mediaId}_${hash}.jpg` },
    { ...source, sha256: "b".repeat(64) },
    { ...source, mimeType: "image/jpeg" as const },
    { ...source, key: "https://foreign.invalid/image.png" },
  ]) {
    media.optimized = invalid;
    const before = f.log.length;
    await assert.rejects(prepare(), error => error instanceof ProposalMediaError && error.code === "KP_MEDIA_INVALID");
    assert.deepEqual(f.log.slice(before), [], "invalid source is rejected before copy reservation or storage I/O");
  }
});

test("private read rejects other owner and rechecks access after network; renderer gets unique bounded assets", async () => {
  const f = fixture(), uploaded = await uploadProposalImage(f.dependencies, { ...f.operation, original: await image(), fileName: "x.png" });
  const request = { actorId: f.operation.actorId, proposalId: owner.proposalId, mediaId: uploaded.mediaId,
    variant: "optimized" as const, scope: { kind: "current" as const } };
  await assert.rejects(readProposalMedia(f.dependencies, { ...request, proposalId: "other-owner" }), /недоступно/);
  const assets = await resolveProposalMediaAssets(f.dependencies, { actorId: request.actorId, proposalId: request.proposalId,
    scope: request.scope, items: [{ id: "a", image: uploaded.reference }, { id: "b", image2: uploaded.reference }] });
  assert.equal(assets.length, 1); assert.equal(assets[0].mimeType, "image/jpeg");
  assert.ok(Buffer.from(assets[0].bytesBase64, "base64").length > 0);
  const get = f.dependencies.storage.read;
  f.dependencies.storage.read = async (target, object) => { const data = await get(target, object); f.setLive(false); return data; };
  await assert.rejects(readProposalMedia(f.dependencies, request), /прав/);
});

test("preview is same-origin and never turns arbitrary URLs into renderer inputs", () => {
  assert.equal(proposalMediaPreviewUrl("proposal-a", "kp-media:media-a", { kind: "version", versionId: "version-a" }),
    "/api/kp/documents/proposal-a/media/media-a?variant=optimized&scope=version&versionId=version-a");
  assert.throws(() => proposalMediaPreviewUrl("proposal-a", "https://private.example/?secret=x", { kind: "current" }));
});
