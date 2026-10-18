import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { KP_IMAGE_MAX_BYTES, imageMimeFromBytes, itemMediaReferences, mediaIdFromToken, mediaObjectKeys,
  mediaSha256, mediaToken, proposalMediaExpiry, validateMediaPlan } from "../src/server/kp/media-contract";
import { prepareProposalImage } from "../src/server/kp/media-image";

test("real codecs preserve original bytes and produce bounded JPEG", async () => {
  for (const format of ["jpeg", "png", "webp"] as const) {
    const original = await sharp({ create: { width: 1900, height: 1000, channels: 3, background: "#99bb22" } })[format]().toBuffer();
    const output = await prepareProposalImage({ original, fileName: `picture.${format}` });
    assert.deepEqual(output.original, original);
    assert.equal(output.originalHash, mediaSha256(original));
    assert.equal(output.optimizedMimeType, "image/jpeg");
    assert.equal(output.width, 1600);
    assert.equal(output.height, 842);
    assert.equal((await sharp(output.optimized).metadata()).width, 1600);
  }
});

test("prepared browser/import optimized is not recompressed even when already JPEG", async () => {
  const original = await sharp({ create: { width: 50, height: 40, channels: 3, background: "red" } }).png().toBuffer();
  const optimized = await sharp(original).jpeg({ quality: 73 }).toBuffer();
  const result = await prepareProposalImage({ original, optimized, fileName: "x.png", optimizedMimeType: "image/jpeg" });
  assert.deepEqual(result.optimized, optimized);
  assert.notEqual(result.originalHash, result.optimizedHash);
  assert.equal(result.width, 50);
  const imported = await prepareProposalImage({ original: optimized, optimized, fileName: "existing.jpg" });
  assert.deepEqual(imported.optimized, optimized);
});

test("magic, decoder, declared type and 15 MiB boundary reject malformed uploads", async () => {
  const valid = await sharp({ create: { width: 3, height: 2, channels: 3, background: "blue" } }).png().toBuffer();
  await assert.rejects(prepareProposalImage({ original: valid, mimeType: "image/jpeg", fileName: "x.jpg" }), /Некорректное/);
  await assert.rejects(prepareProposalImage({ original: Buffer.from("<svg/>"), fileName: "x.jpg" }), /Некорректное/);
  await assert.rejects(prepareProposalImage({ original: valid.subarray(0, 20), fileName: "x.png" }), /Некорректное/);
  await assert.rejects(prepareProposalImage({ original: Buffer.alloc(KP_IMAGE_MAX_BYTES + 1), fileName: "big" }), /15 МиБ/);
  assert.equal(imageMimeFromBytes(valid), "image/png");
});

test("state stores only opaque owned IDs; URL paths credentials and duplicated item IDs are rejected", () => {
  assert.equal(mediaToken("media-a"), "kp-media:media-a");
  assert.equal(mediaIdFromToken(""), null);
  for (const value of ["https://private.invalid/x?secret=123", "data:image/png;base64,AA", "kp-media:../other", "kp-media:a/b"])
    assert.throws(() => mediaIdFromToken(value));
  assert.deepEqual(itemMediaReferences([{ id: "item-1", image: "kp-media:one", image2: "kp-media:one" }]),
    [{ itemId: "item-1", mediaIds: ["one"] }]);
  assert.throws(() => itemMediaReferences([{ id: "a" }, { id: "a" }]));
});

test("object namespaces cannot escape owner and annual expiry uses source date", () => {
  assert.deepEqual(mediaObjectKeys("proposal-a", "media-a", "image/png", "image/jpeg"), {
    original: "kp/proposals/proposal-a/original/media-a.png", optimized: "kp/proposals/proposal-a/optimized/media-a.jpg",
  });
  assert.throws(() => mediaObjectKeys("../other", "media-a", "image/png", "image/jpeg"));
  assert.equal(proposalMediaExpiry(new Date("2024-02-29T11:00:00Z")).toISOString(), "2025-02-28T11:00:00.000Z");
  assert.equal(proposalMediaExpiry(new Date("2025-10-18T11:00:00Z")).toISOString(), "2026-10-18T11:00:00.000Z");
  assert.throws(() => validateMediaPlan({ optimized: { key: "https://invalid.example" } }));
});
