import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectVersionsCommand, type S3Client } from "@aws-sdk/client-s3";
import { createRetentionS3Storage } from "../src/server/kp/retention-storage";
import { RetentionError } from "../src/server/kp/retention-contract";
import { digest, retentionBinding } from "./helpers/kp-retention-fixture";

const configuration = () => ({ mode: "s3" as const, ...retentionBinding, region: "us-east-1", accessKeyId: "synthetic-key", secretAccessKey: "synthetic-secret" });
test("S3 port preserves exact version IDs/cursors and never sends a prefix deletion", async () => {
  const commands: unknown[] = [], bytes = Buffer.from("owned data");
  const send = async (command: unknown) => {
    commands.push(command);
    if (command instanceof ListObjectVersionsCommand) return { Versions: [{ Key: "own-key", VersionId: "version" }], DeleteMarkers: [{ Key: "own-key", VersionId: "marker" }],
      IsTruncated: true, NextKeyMarker: "own-key", NextVersionIdMarker: "marker" };
    if (command instanceof HeadObjectCommand) return { ContentLength: bytes.length };
    if (command instanceof GetObjectCommand) return { ContentLength: bytes.length, Body: Readable.from([bytes.subarray(0, 2), bytes.subarray(2)]) };
    return {};
  };
  const storage = createRetentionS3Storage({ configuration, client: () => ({ send } as unknown as Pick<S3Client, "send">) });
  const list = await storage.list(retentionBinding, "own-key", { key: "prior-key", version: "prior-version" });
  assert.deepEqual(list.next, { key: "own-key", version: "marker" });
  assert.deepEqual(list.entries.map(value => [value.id, value.marker]), [["version", false], ["marker", true]]);
  assert.deepEqual(await storage.digest(retentionBinding, "own-key", "version", bytes.length), { size: bytes.length, sha256: digest(bytes) });
  await storage.deleteVersion(retentionBinding, "own-key", "marker");
  const listed = commands[0] as ListObjectVersionsCommand, get = commands[1] as GetObjectCommand, deletion = commands[2] as DeleteObjectCommand;
  assert.equal(listed.input.Prefix, "own-key"); assert.equal(listed.input.KeyMarker, "prior-key"); assert.equal(listed.input.VersionIdMarker, "prior-version");
  assert.equal(get.input.VersionId, "version"); assert.equal(deletion.input.Key, "own-key"); assert.equal(deletion.input.VersionId, "marker");
  assert.equal(deletion.input.Bucket, retentionBinding.bucket);
});
test("S3 digest streams are size bounded and failures hide private endpoint/credentials", async () => {
  const storage = createRetentionS3Storage({ configuration, client: () => ({ send: async () => ({ Body: Readable.from([Buffer.alloc(8), Buffer.alloc(8)]) }) } as unknown as Pick<S3Client, "send">) });
  await assert.rejects(storage.digest(retentionBinding, "own-key", "version", 10), /CHECKSUM_CHANGED/);
  const failure = createRetentionS3Storage({ configuration, client: () => ({ send: async () => { throw Error("private-endpoint synthetic-secret"); } } as unknown as Pick<S3Client, "send">) });
  await assert.rejects(failure.deleteVersion(retentionBinding, "own-key", "v"), error => error instanceof RetentionError && error.code === "KP_RETENTION_STORAGE_FAILED" && !error.message.includes("secret"));
});
test("incomplete/non-S3 target or changed binding invokes no remote client", async () => {
  let calls = 0;
  const storage = createRetentionS3Storage({ configuration, client: () => { calls++; throw Error("must not allocate client"); } });
  await assert.rejects(storage.deleteVersion({ ...retentionBinding, bucket: "another-target" }, "own-key", "v"), /STORAGE_CHANGED/);
  assert.equal(calls, 0);
  const local = createRetentionS3Storage({ configuration: () => ({ mode: "local" }) });
  assert.throws(() => local.currentBinding(), /STORAGE_CHANGED/);
});
