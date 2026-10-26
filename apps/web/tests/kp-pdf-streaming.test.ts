import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { once } from "node:events";
import { mkdtemp, readdir, readFile, writeFile, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { PassThrough, Readable } from "node:stream";
import { getKpTemplateIdentity } from "@pero/kp-template";
import { spoolPdf, pdfDownloadStream, PDF_MAX_BYTES } from "../src/server/kp/pdf-io";
import { renderProposalPdfStream } from "../src/server/kp/renderer-client";
import { createPdfRenderHandler, createRenderWorker } from "../src/server/kp/render-worker";
import { requestProposalPdf } from "../src/server/kp/lifecycle";
import { lifecycleFixture } from "./helpers/kp-lifecycle-fixture";

const pdf = Buffer.from("%PDF-1.7\nsmall-stream-fixture\n"), hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const identity = getKpTemplateIdentity(), secret = "SYNTHETIC_PRIVATE_PDF_STREAM_184_TEST";
const { createRendererServer } = createRequire(import.meta.url)("../../kp-renderer/server.cjs") as {
  createRendererServer(options: { secret: string; spoolRoot: string; run(input: { kind: string; spoolDirectory: string }): Promise<{ kind: "pdf-file"; path: string; size: number; sha256: string; pageCount: number; templateHash: string }> }): Server & { shutdown(): Promise<void> };
};
async function withSpool(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "pero-pdf-test-")), prior = process.env.PERO_KP_PDF_SPOOL_ROOT;
  process.env.PERO_KP_PDF_SPOOL_ROOT = root;
  try { await run(root); assert.deepEqual(await readdir(root), [], "owned spools must be disposed"); }
  finally { if (prior === undefined) delete process.env.PERO_KP_PDF_SPOOL_ROOT; else process.env.PERO_KP_PDF_SPOOL_ROOT = prior; await rmdir(root); }
}

test("real Node HTTP sender/receiver frame verified binary assets and spool binary PDF without JSON/base64", async () => withSpool(async root => {
  const asset = Buffer.from("small-image-bytes"), opened: string[] = [];
  const server = createRendererServer({ secret, spoolRoot: root, run: async input => {
    assert.equal(input.kind, "pdf-stream"); const manifest = JSON.parse(await readFile(path.join(input.spoolDirectory, "manifest.json"), "utf8"));
    assert.equal(manifest.protocol, 1); assert.equal(manifest.state.unknown.keep, true); assert.equal(manifest.assets[0].sha256, hash(asset));
    assert.equal("bytesBase64" in manifest.assets[0], false);
    assert.deepEqual(await readFile(path.join(input.spoolDirectory, "asset-0.png")), asset); assert.deepEqual(await readFile(path.join(input.spoolDirectory, "asset-1.png")), asset);
    const file = path.join(input.spoolDirectory, "output.pdf"); await writeFile(file, pdf, { flag: "wx", mode: 0o600 });
    return { kind: "pdf-file", path: file, size: pdf.length, sha256: hash(pdf), pageCount: 200, templateHash: identity.templateHash };
  } });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const result = await renderProposalPdfStream({ kind: "pdf", proposalId: "proposal", revision: 3, templateHash: identity.templateHash, state: { items: [{ id: "item", image: "kp-media:first", image2: "kp-media:second" }], unknown: { keep: true } },
      assets: ["first", "second"].map(mediaId => ({ mediaId, mimeType: "image/png", size: asset.length, sha256: hash(asset), openRead: async () => { opened.push(mediaId); return Readable.from([asset]); } })) },
    { baseUrl: `http://127.0.0.1:${address.port}`, secret });
    assert.deepEqual(opened, ["first", "second"]); assert.equal(result.pageCount, 200); assert.equal(result.file.size, pdf.length);
    const chunks: Buffer[] = []; for await (const chunk of await result.file.openRead()) chunks.push(chunk); assert.deepEqual(Buffer.concat(chunks), pdf);
    await result.file.dispose(); await assert.rejects(stat(result.file.path), { code: "ENOENT" });
  } finally { await server.shutdown(); }
}));

test("spool rejects truncated/corrupt/over-Int metadata and disposes file on cancellation", async () => withSpool(async root => {
  for (const expected of [{ size: pdf.length + 1, sha256: hash(pdf) }, { size: pdf.length, sha256: "a".repeat(64) }, { size: PDF_MAX_BYTES + 1, sha256: hash(pdf) }])
    await assert.rejects(spoolPdf(Readable.from([pdf]), expected, undefined, root));
  const file = await spoolPdf(Readable.from([pdf]), { size: pdf.length, sha256: hash(pdf) }, undefined, root);
  const stream = pdfDownloadStream(async function* (signal) { yield* await file.openRead(signal); }, undefined, file.dispose);
  await stream.cancel(); await assert.rejects(stat(file.path), { code: "ENOENT" });
}));

test("ownership abort closes a pending asset and native HTTP request without leaving PDF spool", async () => withSpool(async () => {
  const controller = new AbortController(), asset = new PassThrough();
  const server = createServer(request => request.resume()); server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    await assert.rejects(renderProposalPdfStream({ kind: "pdf", proposalId: "proposal", revision: 1, templateHash: identity.templateHash, state: { items: [] },
      assets: [{ mediaId: "image", mimeType: "image/png", size: 10, sha256: "a".repeat(64), openRead: async signal => {
        signal!.addEventListener("abort", () => asset.destroy(), { once: true }); asset.write(Buffer.from("first")); setImmediate(() => controller.abort()); return asset;
      } }] }, { baseUrl: `http://127.0.0.1:${address.port}`, secret, signal: controller.signal }));
    assert.equal(asset.destroyed, true);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}));

test("lease/revision fence after streamed render disposes PDF spool and prevents S3 upload/publication", async () => withSpool(async root => {
  const f = lifecycleFixture(); let spoolPath = "";
  f.io.render = async input => {
    const file = await spoolPdf(Readable.from([pdf]), { size: pdf.length, sha256: hash(pdf) }, undefined, root); spoolPath = file.path;
    f.state.proposal.revision++; return { file, templateHash: input.templateHash };
  };
  await f.transaction(store => requestProposalPdf(store, f.binding, { proposalId: f.state.proposal.id, expectedRevision: 1, operationId: "00000000-0000-4000-8000-000000000184" }, f.ports));
  const worker = createRenderWorker({ queue: f.queue, handlers: { PDF: createPdfRenderHandler({ transaction: f.transaction, ports: f.ports, io: f.io }) }, environment: () => ({ PERO_KP_ENABLED: "1", PERO_KP_WORKER_ENABLED: "1" }) });
  assert.equal(await worker.runOne(), "failed"); assert.equal(f.uploaded.size, 0); assert.equal(f.state.artifacts.size, 0); assert.equal(f.state.versions.size, 0);
  await assert.rejects(stat(spoolPath), { code: "ENOENT" });
}));

test("file render reserves exact pending artifact before upload and disposes spool after durable publication", async () => withSpool(async root => {
  const f = lifecycleFixture(); let spoolPath = "", reads = 0;
  f.io.render = async input => { const file = await spoolPdf(Readable.from([pdf]), { size: pdf.length, sha256: hash(pdf) }, undefined, root); spoolPath = file.path; return { file, templateHash: input.templateHash }; };
  f.io.upload = async (artifact, source, signal) => {
    assert.ok(!(source instanceof Uint8Array)); assert.equal(f.state.artifacts.get(artifact.id)?.state, "PENDING"); assert.ok(f.state.orphans.some(intent => intent.artifactId === artifact.id));
    const chunks: Buffer[] = []; for await (const chunk of await source.openRead(signal)) chunks.push(chunk); assert.deepEqual(Buffer.concat(chunks), pdf); reads++;
    return { id: artifact.id, storageBinding: artifact.storageBinding, key: artifact.key, sha256: hash(pdf), size: pdf.length };
  };
  f.io.verify = async () => { throw Error("READBACK_ALREADY_RETURNED_BY_UPLOAD"); };
  await f.transaction(store => requestProposalPdf(store, f.binding, { proposalId: f.state.proposal.id, expectedRevision: 1, operationId: "00000000-0000-4000-8000-000000000184" }, f.ports));
  const worker = createRenderWorker({ queue: f.queue, handlers: { PDF: createPdfRenderHandler({ transaction: f.transaction, ports: f.ports, io: f.io }) }, environment: () => ({ PERO_KP_ENABLED: "1", PERO_KP_WORKER_ENABLED: "1" }) });
  assert.equal(await worker.runOne(), "succeeded"); assert.equal(reads, 1); assert.equal(f.state.versions.size, 1); assert.equal([...f.state.artifacts.values()][0].state, "READY");
  await assert.rejects(stat(spoolPath), { code: "ENOENT" });
}));
