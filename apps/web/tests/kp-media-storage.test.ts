import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { ProposalMediaError, mediaSha256, type MediaBinding, type MediaObject } from "../src/server/kp/media-contract";
import { createProposalMediaS3Storage, putVerifiedProposalMedia, type ProposalMediaStorage } from "../src/server/kp/media-storage";

const binding: MediaBinding = { endpoint: "https://media.invalid/", bucket: "crm-unit", region: "us-east-1" };
const bytes = Buffer.from("synthetic-image-bytes");
const object: MediaObject = { key: "kp/proposals/a/optimized/b.jpg", sha256: mediaSha256(bytes), size: bytes.length, mimeType: "image/jpeg" };

test("unknown write ACK and pre-existing identical bytes finish only after actual readback", async () => {
  let puts = 0, gets = 0, activeChecks = 0;
  const storage: ProposalMediaStorage = {
    currentBinding: () => binding,
    putIfAbsent: async () => { puts++; throw Error("uncertain-private-endpoint"); },
    read: async () => { gets++; return Buffer.from(bytes); },
  };
  await putVerifiedProposalMedia(storage, binding, object, bytes, async () => { activeChecks++; });
  assert.deepEqual([puts, gets, activeChecks], [1, 1, 2]);
});

test("mismatched existing bytes are never overwritten or acknowledged", async () => {
  let puts = 0;
  const storage: ProposalMediaStorage = { currentBinding: () => binding,
    putIfAbsent: async () => { puts++; throw Error("PreconditionFailed"); }, read: async () => Buffer.alloc(bytes.length) };
  await assert.rejects(putVerifiedProposalMedia(storage, binding, object, bytes),
    error => error instanceof ProposalMediaError && error.code === "KP_MEDIA_CHECKSUM_MISMATCH");
  assert.equal(puts, 1);
  storage.read = async () => null;
  await assert.rejects(putVerifiedProposalMedia(storage, binding, object, bytes), /подтвердить/);
});

test("target change or revoked owner stops before another storage call", async () => {
  let puts = 0, gets = 0, current = binding;
  const storage: ProposalMediaStorage = { currentBinding: () => current,
    putIfAbsent: async () => { puts++; current = { ...binding, bucket: "other-unit" }; }, read: async () => { gets++; return bytes; } };
  await assert.rejects(putVerifiedProposalMedia(storage, binding, object, bytes), /хранилище/);
  assert.deepEqual([puts, gets], [1, 0]);
  current = binding;
  await assert.rejects(putVerifiedProposalMedia(storage, binding, object, bytes, async () => { throw new ProposalMediaError("KP_MEDIA_FORBIDDEN"); }), /прав/);
  assert.deepEqual([puts, gets], [1, 0]);
});

test("S3 adapter sends immutable private put with known length and SHA and reads actual bounded stream", async () => {
  const seen: unknown[] = [];
  const send = async (command: PutObjectCommand | GetObjectCommand) => {
    seen.push(command);
    if (command instanceof PutObjectCommand) return {};
    return { Body: Readable.from([bytes.subarray(0, 3), bytes.subarray(3)]), ContentLength: bytes.length };
  };
  const storage = createProposalMediaS3Storage({ configuration: () => ({ mode: "s3", ...binding, region: "us-east-1",
    accessKeyId: "synthetic-access", secretAccessKey: "synthetic-secret" }),
    client: () => ({ send } as unknown as Pick<S3Client, "send">) });
  await putVerifiedProposalMedia(storage, binding, object, bytes);
  const put = seen[0] as PutObjectCommand;
  assert.equal(put.input.IfNoneMatch, "*");
  assert.equal(put.input.ContentLength, bytes.length);
  assert.equal(put.input.ChecksumSHA256, Buffer.from(object.sha256, "hex").toString("base64"));
  assert.equal(put.input.ACL, undefined);
  assert.equal(put.input.Bucket, binding.bucket);
  assert.equal(put.input.Key, object.key);
  assert.ok(seen[1] instanceof GetObjectCommand);
});

test("S3 adapter never falls back to disk and bounds malicious stream without trusting declared size", async () => {
  let calls = 0;
  const storage = createProposalMediaS3Storage({ configuration: () => ({ mode: "s3", ...binding, region: "us-east-1",
    accessKeyId: "test", secretAccessKey: "test" }),
    client: () => ({ send: async () => { calls++; return { Body: Readable.from([bytes, Buffer.from("overflow")]) }; } } as unknown as Pick<S3Client, "send">) });
  await assert.rejects(storage.read(binding, object), error => error instanceof ProposalMediaError && error.code === "KP_MEDIA_CHECKSUM_MISMATCH");
  assert.equal(calls, 1);
  const local = createProposalMediaS3Storage({ configuration: () => ({ mode: "local" }) });
  assert.throws(() => local.currentBinding(), /хранилище/);
  await assert.rejects(storage.read({ ...binding, bucket: "another-unit" }, object), /хранилище/);
  assert.equal(calls, 1);
});
