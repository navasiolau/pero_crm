import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createProposalArtifactStorage, type ArtifactStorageObject } from "../src/server/kp/artifact-storage";
import { KpApiError } from "../src/server/kp/api-contract";

const bytes = Buffer.from("%PDF-test");
const configuration = { mode: "s3" as const, endpoint: "https://storage.example.invalid", bucket: "private-kp", region: "us-east-1", accessKeyId: "TEST_KEY", secretAccessKey: "TEST_SECRET" };
const artifact: ArtifactStorageObject & { id: string } = { id: "artifact", proposalId: "proposal", contractId: null,
  storageBinding: { endpoint: configuration.endpoint, bucket: configuration.bucket, region: configuration.region }, key: "kp/proposals/proposal/exports/job-1-artifact.pdf",
  sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length, mimeType: "application/pdf" };

test("abort after HTTP headers destroys a slow artifact body and rejects promptly", async () => {
  const stream = new PassThrough(), controller = new AbortController(); let destroyed = 0;
  const storage = createProposalArtifactStorage({ configuration: () => configuration, client: () => ({
    send: async () => { stream.write(bytes.subarray(0, 1)); setImmediate(() => controller.abort()); return { Body: stream, ContentLength: bytes.length }; },
    destroy: () => { destroyed++; },
  } as unknown as S3Client) });
  await assert.rejects(storage.read(artifact, async () => {}, controller.signal));
  assert.equal(stream.destroyed, true); assert.equal(destroyed, 1);
});

test("abort between headers and body iteration does not emit an unhandled stream error", async () => {
  const stream = new PassThrough(), controller = new AbortController(); const errors: Error[] = [];
  // Listener позволяет увидеть прежнюю ошибку без падения тестового процесса.
  stream.on("error", error => { errors.push(error); });
  const storage = createProposalArtifactStorage({ configuration: () => configuration, client: () => ({
    send: async () => { controller.abort(); return { Body: stream, ContentLength: bytes.length }; },
  } as unknown as S3Client) });
  await assert.rejects(storage.read(artifact, async () => {}, controller.signal));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(stream.destroyed, true); assert.deepEqual(errors, []);
});
test("one timeout covers headers and body, including no caller abort signal", async () => {
  const stream = new PassThrough();
  const storage = createProposalArtifactStorage({ timeoutMs: 15, configuration: () => configuration,
    client: () => ({ send: async () => { stream.write(bytes.subarray(0, 1)); return { Body: stream }; } } as unknown as S3Client) });
  const keepAlive = setTimeout(() => {}, 500);
  try { await assert.rejects(storage.read(artifact, async () => {})); assert.equal(stream.destroyed, true); }
  finally { clearTimeout(keepAlive); }
});
test("binding change after the body fails without constructing a second unused client", async () => {
  let current = { ...configuration }, clients = 0;
  const stream = Readable.from((async function* () { yield bytes; current = { ...current, bucket: "different-target" }; })());
  const storage = createProposalArtifactStorage({ configuration: () => current, client: () => {
    clients++; return { send: async () => ({ Body: stream, ContentLength: bytes.length }) } as unknown as S3Client;
  } });
  await assert.rejects(storage.read(artifact, async () => {}), /привязка/); assert.equal(clients, 1);
});
test("unknown PUT ACK succeeds only with immutable PUT and verified GET readback", async () => {
  let authCalls = 0; const calls: string[] = [];
  const storage = createProposalArtifactStorage({ configuration: () => configuration, client: () => ({ send: async (command: unknown) => {
    if (command instanceof PutObjectCommand) { calls.push("put"); assert.equal(command.input.IfNoneMatch, "*"); assert.equal(command.input.Key, artifact.key); throw Error("ACK_LOST"); }
    assert.ok(command instanceof GetObjectCommand); calls.push("get"); return { Body: Readable.from([bytes]), ContentLength: bytes.length };
  } } as unknown as S3Client) });
  const result = await storage.uploadAndVerify(artifact, bytes, async () => { authCalls++; });
  assert.equal(result.id, "artifact"); assert.equal(result.sha256, artifact.sha256); assert.deepEqual(calls, ["put", "get"]); assert.ok(authCalls >= 4);
});
test("wrong owner namespace and oversized actual body are rejected before accepting bytes", async () => {
  let sends = 0;
  const storage = createProposalArtifactStorage({ configuration: () => configuration, client: () => ({ send: async () => { sends++; return { Body: Readable.from([Buffer.concat([bytes, Buffer.from("extra")])]) }; } } as unknown as S3Client) });
  await assert.rejects(storage.read({ ...artifact, key: "kp/contracts/foreign/exports/file.pdf" }, async () => {})); assert.equal(sends, 0);
  await assert.rejects(storage.read(artifact, async () => {})); assert.equal(sends, 1);
});

test("temporary network failure remains retryable, while missing or corrupt artifacts are terminal", async () => {
  for (const failure of [Error("network-internal-secret"), Object.assign(Error("missing"), { name: "NoSuchKey" })]) {
    const storage = createProposalArtifactStorage({ configuration: () => configuration, client: () => ({ send: async () => { throw failure; } } as unknown as S3Client) });
    await assert.rejects(storage.read(artifact, async () => {}), error => error instanceof KpApiError &&
      error.status === (failure.name === "NoSuchKey" ? 410 : 503) && !error.message.includes("internal-secret"));
  }
  const storage = createProposalArtifactStorage({ configuration: () => configuration, client: () => ({ send: async () => ({ Body: Readable.from([Buffer.alloc(bytes.length)]) }) } as unknown as S3Client) });
  await assert.rejects(storage.read(artifact, async () => {}), error => error instanceof KpApiError && error.status === 410);
});
