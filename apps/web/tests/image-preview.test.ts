import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { createImagePreviewService, createPreviewLimiter } from "../src/server/files/image-preview";

const file = { id: "image-1", projectId: "project-1", productId: "product-1",
  storedName: "image.jpg", mimeType: "image/jpeg", size: 200_000,
  createdAt: new Date("2026-09-30T00:00:00.000Z") };
const actor = { id: "manager", roles: ["MANAGER"] };

async function sourceImage() {
  return sharp({ create: { width: 2400, height: 1800, channels: 3,
    background: { r: 80, g: 140, b: 190 } } }).jpeg({ quality: 90 }).toBuffer();
}

test("card and cover previews are bounded WebP, while original bytes never become fallback", async () => {
  const original = await sourceImage();
  let loads = 0;
  const preview = createImagePreviewService({
    lookup: async () => file,
    loadOriginal: async () => { loads++; return original; },
  });
  const card = await preview.respond({ actor, fileId: file.id, variant: "card" });
  assert.equal(card.status, 200);
  assert.equal(card.headers.get("Content-Type"), "image/webp");
  assert.equal(card.headers.get("Cache-Control"), "private, max-age=0, must-revalidate");
  assert.equal(card.headers.get("Vary"), "Cookie");
  const cardBuffer = Buffer.from(await card.arrayBuffer());
  const cardMeta = await sharp(cardBuffer).metadata();
  assert.equal(cardMeta.format, "webp");
  assert.ok(cardMeta.width! <= 480 && cardMeta.height! <= 480);
  assert.ok(cardBuffer.length < original.length);
  const cover = await preview.respond({ actor, fileId: file.id, variant: "cover" });
  const coverMeta = await sharp(Buffer.from(await cover.arrayBuffer())).metadata();
  assert.ok(coverMeta.width! <= 1280 && coverMeta.height! <= 1600);
  assert.ok(coverMeta.width! > cardMeta.width!);
  assert.equal(loads, 2);
});

test("warm cache and conditional 304 still perform actor ACL lookup before serving bytes or metadata", async () => {
  const original = await sourceImage();
  let allowed = true;
  let lookups = 0;
  let loads = 0;
  const preview = createImagePreviewService({
    lookup: async () => { lookups++; return allowed ? file : null; },
    loadOriginal: async () => { loads++; return original; },
  });
  const first = await preview.respond({ actor, fileId: file.id, variant: "card" });
  const etag = first.headers.get("ETag");
  assert.ok(etag);
  const notModified = await preview.respond({ actor, fileId: file.id, variant: "card", ifNoneMatch: etag! });
  assert.equal(notModified.status, 304);
  assert.equal(notModified.headers.get("Cache-Control"), "private, max-age=0, must-revalidate");
  assert.equal(loads, 1);
  allowed = false;
  const denied = await preview.respond({ actor: { id: "revoked", roles: ["WORKER"] },
    fileId: file.id, variant: "card", ifNoneMatch: etag! });
  assert.equal(denied.status, 404);
  assert.equal(denied.headers.get("ETag"), null);
  assert.equal(lookups, 3, "ACL must run for every request, even a cache hit or 304");
});

test("invalid image, missing storage and nonimage MIME fail closed without original fallback", async () => {
  const preview = createImagePreviewService({
    lookup: async () => file,
    loadOriginal: async () => Buffer.from("not-an-image"),
  });
  const broken = await preview.respond({ actor, fileId: file.id, variant: "cover" });
  assert.notEqual(broken.status, 200);
  assert.notEqual(broken.headers.get("Content-Type"), "image/jpeg");
  const missing = createImagePreviewService({ lookup: async () => file, loadOriginal: async () => null });
  assert.equal((await missing.respond({ actor, fileId: file.id, variant: "card" })).status, 404);
  const nonimage = createImagePreviewService({
    lookup: async () => ({ ...file, mimeType: "application/octet-stream" }),
    loadOriginal: async () => { throw new Error("must not read original"); },
  });
  assert.equal((await nonimage.respond({ actor, fileId: file.id, variant: "card" })).status, 415);
});

test("parallel requests for the same preview share one bounded transform", async () => {
  const original = await sourceImage();
  let loads = 0;
  const preview = createImagePreviewService({
    lookup: async () => file,
    loadOriginal: async () => { loads++; await new Promise((resolve) => setTimeout(resolve, 10)); return original; },
  });
  const replies = await Promise.all(Array.from({ length: 5 }, () => preview.respond({ actor, fileId: file.id,
    variant: "card" })));
  assert.ok(replies.every((reply) => reply.status === 200));
  assert.equal(loads, 1);
});

test("preview never upscales small sources and rejects oversized metadata before storage read", async () => {
  const small = await sharp({ create: { width: 60, height: 40, channels: 3,
    background: "#336699" } }).png().toBuffer();
  let reads = 0;
  const preview = createImagePreviewService({
    lookup: async () => file,
    loadOriginal: async () => { reads++; return small; },
  });
  const result = await preview.respond({ actor, fileId: file.id, variant: "cover" });
  assert.deepEqual(await sharp(Buffer.from(await result.arrayBuffer())).metadata().then(({ width, height }) =>
    ({ width, height })), { width: 60, height: 40 });
  const huge = createImagePreviewService({
    lookup: async () => ({ ...file, size: 25 * 1024 * 1024 + 1 }),
    loadOriginal: async () => { reads++; return small; },
  });
  assert.equal((await huge.respond({ actor, fileId: file.id, variant: "card" })).status, 413);
  assert.equal(reads, 1);
});

test("different previews respect a two-job transform limit", async () => {
  const original = await sourceImage();
  let active = 0;
  let peak = 0;
  const preview = createImagePreviewService({
    lookup: async (_actor, id) => ({ ...file, id }),
    loadOriginal: async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active--;
      return original;
    },
  });
  const replies = await Promise.all(Array.from({ length: 5 }, (_, i) => preview.respond({ actor,
    fileId: `image-${i}`, variant: "card" })));
  assert.ok(replies.every((reply) => reply.status === 200));
  assert.equal(peak, 2);
});

test("a released slot is reserved for its queued waiter before a newcomer can acquire", async () => {
  const limiter = createPreviewLimiter(2);
  const releaseA = await limiter.acquire();
  const releaseB = await limiter.acquire();
  let thirdGranted = false;
  let fourthGranted = false;
  const third = limiter.acquire().then((release) => { thirdGranted = true; return release; });
  releaseA();
  const fourth = limiter.acquire().then((release) => { fourthGranted = true; return release; });
  const releaseThird = await third;
  assert.equal(thirdGranted, true);
  assert.equal(fourthGranted, false, "The handoff must not temporarily expose a free slot");
  releaseThird();
  const releaseFourth = await fourth;
  assert.equal(fourthGranted, true);
  releaseFourth();
  releaseB();
});

test("bounded LRU evicts the oldest transformed preview", async () => {
  const one = await sharp({ create: { width: 800, height: 600, channels: 3,
    background: "#446688" } }).jpeg().toBuffer();
  const two = await sharp({ create: { width: 800, height: 600, channels: 3,
    background: "#882244" } }).jpeg().toBuffer();
  const previewBytes = await sharp(one).resize(480, 480,
    { fit: "inside", withoutEnlargement: true }).webp({ quality: 78, effort: 4 }).toBuffer();
  let reads = 0;
  const preview = createImagePreviewService({
    lookup: async (_actor, id) => ({ ...file, id, storedName: `${id}.jpg`, size: id === "one" ? one.length : two.length }),
    loadOriginal: async (item) => { reads++; return item.id === "one" ? one : two; },
  }, { maxCacheBytes: previewBytes.length + 1 });
  for (const id of ["one", "two", "one"]) {
    const response = await preview.respond({ actor, fileId: id, variant: "card" });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  }
  assert.equal(reads, 3, "Rendering the second asset must evict the oldest asset");
});
