// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при несовпадении guard.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { runInNewContext } from "node:vm";
import type { File as FileRow, FileSection, User } from "@prisma/client";
import { DeleteObjectCommand, GetBucketVersioningCommand, GetObjectCommand, ListObjectVersionsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { encode } from "next-auth/jwt";
import { assertCiRuntimeTarget } from "./runtime/target.mjs";
import { createPostgresFixture } from "./postgres.fixture";
import type { FinanceDocumentView } from "../../src/server/finance-documents/contracts";

export type HttpActor = Pick<User, "id" | "name" | "email" | "roles" | "sessionVersion">;
export type UploadReply = { response: Response; body: { ok?: boolean; id?: string; sketchFileId?: string; clientMutationId?: string; repeated?: boolean; kind?: string; sketch?: { id: string }; error?: string } };

export async function createHttpS3Fixture(scenarioId: string) {
  const target = assertCiRuntimeTarget();
  const pg = await createPostgresFixture(scenarioId);
  const s3 = new S3Client({ endpoint: target.s3.endpoint, region: "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: target.s3.accessKeyId, secretAccessKey: target.s3.secretAccessKey }, maxAttempts: 1 });
  const bucket = target.s3.bucket, projects = new Set<string>(), documents = new Set<string>();
  const ownedKey = (key: string) => {
    assert.ok(projects.has(key.split("/")[0]) || documents.has(key), "Только ключ собственной CI-фикстуры");
    assert.ok(!key.includes("\\") && !key.split("/").some(part => !part || part === "." || part === ".."));
    return key;
  };
  try { assert.equal((await s3.send(new GetBucketVersioningCommand({ Bucket: bucket }))).Status, "Enabled"); }
  catch (error) { s3.destroy(); await pg.dispose(); throw error; }
  const project: typeof pg.project = async (...args) => { const row = await pg.project(...args); projects.add(row.id); return row; };
  async function cookie(actor: HttpActor) {
    const parts = await Promise.all(["authjs.session-token", "__Secure-authjs.session-token"].map(async name =>
      `${name}=${await encode({ secret: target.authSecret, salt: name, maxAge: 900,
        token: { id: actor.id, sessionVersion: actor.sessionVersion, roles: actor.roles } })}`));
    return parts.join("; ");
  }
  async function request(path: string, actor?: HttpActor, init: RequestInit = {}) {
    assert.ok(path.startsWith("/") && !path.startsWith("//"));
    const url = new URL(path, target.baseUrl); assert.equal(url.origin, target.baseUrl);
    const headers = new Headers(init.headers); if (actor) headers.set("cookie", await cookie(actor));
    return fetch(url, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  }
  async function faultRequest(path: string, actor?: HttpActor, init: RequestInit = {}) {
    assertCiRuntimeTarget();
    assert.ok(path.startsWith("/") && !path.startsWith("//"));
    const url = new URL(path, target.faultBaseUrl); assert.equal(url.origin, target.faultBaseUrl);
    const headers = new Headers(init.headers); if (actor) headers.set("cookie", await cookie(actor));
    return fetch(url, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  }
  async function session(actor: HttpActor) {
    const response = await request("/api/auth/session", actor);
    assert.equal(response.status, 200);
    const body = await response.json() as { user?: { id?: string; roles?: string[] } };
    assert.equal(body.user?.id, actor.id); assert.deepEqual(body.user?.roles, actor.roles);
  }
  async function login(email: string, password: string) {
    const cookies = new Map<string, string>();
    const receive = (response: Response) => {
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(";", 1)[0], split = pair.indexOf("=");
        assert.ok(split > 0); cookies.set(pair.slice(0, split), pair);
      }
      return [...cookies.values()].join("; ");
    };
    const csrf = await request("/api/auth/csrf"); assert.equal(csrf.status, 200);
    const { csrfToken } = await csrf.json() as { csrfToken: string }; assert.equal(typeof csrfToken, "string");
    const response = await request("/api/auth/callback/credentials", undefined, { method: "POST",
      headers: { cookie: receive(csrf), "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1", Origin: target.baseUrl },
      body: new URLSearchParams({ csrfToken, email, password, callbackUrl: `${target.baseUrl}/` }) });
    assert.equal(response.status, 200);
    return { response, cookie: receive(response), url: (await response.json() as { url: string }).url };
  }
  async function actionResponse(name: string, page: string, actor: HttpActor | undefined, args: unknown[]) {
    assertCiRuntimeTarget();
    const manifest = JSON.parse(await readFile(path.resolve(".next/server/server-reference-manifest.json"), "utf8")) as {
      node: Record<string, { exportedName?: string; workers: Record<string, unknown> }> };
    const found = Object.entries(manifest.node).filter(([, entry]) => entry.exportedName === name);
    assert.equal(found.length, 1, `CI_ACTION_EXPORT:${name}`); assert.match(found[0][0], /^[a-f0-9]{42}$/);
    return request(page, actor, { method: "POST", headers: { "Next-Action": found[0][0],
      "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component", Origin: target.baseUrl }, body: JSON.stringify(args) });
  }
  async function action<T extends object>(name: string, page: string, actor: HttpActor, args: unknown[]): Promise<T> {
    const response = await actionResponse(name, page, actor, args);
    assert.equal(response.status, 200, name); assert.ok(response.headers.get("content-type")?.startsWith("text/x-component"));
    assert.equal(response.headers.has("x-action-redirect"), false); assert.notEqual(response.headers.get("x-nextjs-action-not-found"), "1");
    const bytes = new Uint8Array(await response.arrayBuffer()); assert.ok(bytes.length <= 2 * 1024 * 1024);
    const require = createRequire(import.meta.url); assert.equal(require("next/package.json").version, "15.5.20");
    const inert = () => { throw Error("CI_FLIGHT_FUNCTION_EXECUTION_REFUSED"); };
    const exports = new Proxy(Object.create(null), { get: (_target, key) => key === "then" ? undefined : key === "__esModule" ? true : inert });
    const info = { id: "ci-inert", chunks: [], name: "*", async: false };
    const moduleMap = new Proxy(Object.create(null), { get: () => new Proxy(Object.create(null), { get: () => info }) });
    const serverModuleMap = new Proxy(Object.create(null), { get: () => ({ ...info, name: "default" }) });
    const actionModule = { exports: {} as { createFromFetch: (response: Promise<Response>, options: object) => Promise<{ a: Promise<unknown> }> } };
    const sandbox = { module: actionModule, exports: actionModule.exports, require: (name: string) => { assert.ok(["react", "react-dom"].includes(name)); return require(name); },
      process: { env: { NODE_ENV: "production" } }, TextDecoder, TextEncoder, ReadableStream, Response, Headers, FormData, Blob, AbortController,
      performance, URL, setTimeout, clearTimeout, queueMicrotask, console: { log() {}, warn() {}, error() {} },
      __webpack_chunk_load__: () => { throw Error("CI_FLIGHT_CHUNK_REFUSED"); }, __next_require__: (id: string) => { assert.equal(id, "ci-inert"); return exports; } };
    const decoder = path.join(path.dirname(require.resolve("next/dist/compiled/react-server-dom-webpack/client.edge")), "cjs/react-server-dom-webpack-client.edge.production.js");
    runInNewContext(await readFile(decoder, "utf8"), sandbox, { timeout: 1000 });
    const decoded = (async () => {
      const envelope = await actionModule.exports.createFromFetch(Promise.resolve(new Response(bytes, { headers: response.headers })),
        { serverConsumerManifest: { moduleMap, serverModuleMap, moduleLoading: null }, replayConsoleLogs: false });
      assert.equal(typeof envelope.a?.then, "function"); return await envelope.a;
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return JSON.parse(JSON.stringify(await Promise.race([decoded, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("CI_FLIGHT_TIMEOUT")), 10_000); })]))) as T; }
    finally { clearTimeout(timer); }
  }
  async function fault<T>(table: "ChangeLog" | "DomainEvent", actorId: string, operation: () => Promise<T>, pluginOwnerId?: string): Promise<T> {
    assertCiRuntimeTarget(); assert.ok(["ChangeLog", "DomainEvent"].includes(table));
    const ownerId = pluginOwnerId ?? actorId;
    assert.ok(ownerId.startsWith(`ci169-${target.runId}-${target.attempt}-${scenarioId}-`)); assert.match(ownerId, /^[a-z0-9.-]+$/);
    assert.equal((await pg.db.user.findUniqueOrThrow({ where: { id: ownerId } })).id, ownerId);
    if (pluginOwnerId) {
      assert.equal(table, "ChangeLog"); assert.equal(actorId, "plugin:demo");
      assert.equal((await pg.db.plugin.findUniqueOrThrow({ where: { id: "demo" } })).name, pg.id("demo-plugin"));
    }
    const name = `ci169_fail_${randomUUID().replaceAll("-", "")}`;
    const [{ quoted }] = await pg.db.$queryRaw<{ quoted: string }[]>`SELECT quote_literal(${actorId}::text) AS quoted`;
    await pg.db.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $ci169$ BEGIN RAISE EXCEPTION 'CI169_EXPECTED_FAULT'; END; $ci169$`);
    try {
      await pg.db.$executeRawUnsafe(`CREATE TRIGGER "${name}" BEFORE INSERT ON "${table}" FOR EACH ROW WHEN (NEW.${table === "ChangeLog" ? '"actorId"' : '"actor"'} = ${quoted}${pluginOwnerId ? ' AND NEW."entity" = \'plugin\' AND NEW."entityId" = \'demo\' AND NEW."action" = \'command.ping\'' : ""}) EXECUTE FUNCTION "${name}"()`);
      try { return await operation(); } finally { await pg.db.$executeRawUnsafe(`DROP TRIGGER "${name}" ON "${table}"`); }
    } finally { await pg.db.$executeRawUnsafe(`DROP FUNCTION "${name}"()`); }
  }
  async function put(key: string, bytes: Uint8Array, contentType: string) {
    if (key.startsWith("finance-documents/") && !documents.has(key)) {
      assert.match(key, /^finance-documents\/[0-9a-f-]{36}\/[a-f0-9]{64}$/);
      const row = await pg.db.financeDocument.findFirst({ where: { storageKey: key,
        uploadedById: { startsWith: `ci169-${target.runId}-${target.attempt}-${scenarioId}-` } } });
      assert.ok(row); assert.equal(row.storageMode, "s3");
      assert.equal(key, `finance-documents/${row.id}/${row.contentHash}`); documents.add(key);
    }
    const result = await s3.send(new PutObjectCommand({ Bucket: bucket, Key: ownedKey(key), Body: bytes, ContentType: contentType }));
    assert.ok(result.VersionId && result.VersionId !== "null"); return result.VersionId;
  }
  async function get(key: string, versionId?: string) {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: ownedKey(key), VersionId: versionId }));
    assert.ok(result.Body); return Buffer.from(await result.Body.transformToByteArray());
  }
  async function deleteMarker(key: string) {
    const result = await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: ownedKey(key) }));
    assert.equal(result.DeleteMarker, true); assert.ok(result.VersionId); return result.VersionId;
  }
  async function versions(subject: string) {
    assert.ok(projects.has(subject) || documents.has(subject));
    const result = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: projects.has(subject) ? `${subject}/` : subject, MaxKeys: 1000 }));
    assert.notEqual(result.IsTruncated, true, "Синтетический case должен оставаться bounded");
    return [
      ...(result.Versions ?? []).map(row => ({ key: row.Key!, versionId: row.VersionId!, marker: false, latest: row.IsLatest!, etag: row.ETag!, size: row.Size! })),
      ...(result.DeleteMarkers ?? []).map(row => ({ key: row.Key!, versionId: row.VersionId!, marker: true, latest: row.IsLatest!, etag: "", size: 0 })),
    ].sort((a, b) => `${a.key}/${a.versionId}`.localeCompare(`${b.key}/${b.versionId}`));
  }
  async function file(label: string, context: Pick<FileRow, "projectId" | "productId">, bytes: Uint8Array, mimeType: string,
    options: { hasThumb?: boolean; missing?: boolean; uploadedById?: string | null; fileName?: string; section?: FileSection; taskId?: string | null } = {}) {
    const storedName = `${randomUUID()}-${label}`, key = `${context.projectId}/${storedName}`;
    if (!options.missing) await put(key, bytes, mimeType);
    return pg.db.file.create({ data: { id: pg.id(label), ...context, storedName, mimeType, size: bytes.length,
      fileName: options.fileName ?? label, section: options.section ?? "PRODUCTION", taskId: options.taskId ?? null, hasThumb: options.hasThumb ?? false,
      uploadedById: options.uploadedById ?? null } });
  }
  async function upload(actor: HttpActor | undefined, input: { projectId: string; productId?: string | null; taskId?: string; section?: FileSection; fileName: string; bytes: Uint8Array;
    clientMutationId: string; expectedSketchFileId?: string | null; mimeType?: string }): Promise<UploadReply> {
    assert.ok(projects.has(input.projectId));
    const form = new FormData(); form.append("file", new File([new Uint8Array(input.bytes)], input.fileName, { type: input.mimeType ?? "image/png" }));
    for (const [key, value] of Object.entries({ projectId: input.projectId, productId: input.productId, taskId: input.taskId,
      section: input.section ?? "PRODUCTION", clientMutationId: input.clientMutationId })) if (value != null) form.append(key, value);
    if (input.expectedSketchFileId !== undefined) { form.append("assignCover", "1"); form.append("expectedSketchFileId", input.expectedSketchFileId ?? "null"); }
    const response = await request("/api/files/upload", actor, { method: "POST", body: form });
    return { response, body: await response.json() as UploadReply["body"] };
  }
  async function financeUpload(actor: HttpActor | undefined, input: { fileName: string; mimeType: string; bytes: Uint8Array; clientMutationId: string }, bot?: { token: string; actorId?: string }) {
    const form = new FormData(); form.append("file", new File([new Uint8Array(input.bytes)], input.fileName, { type: input.mimeType }));
    form.append("clientMutationId", input.clientMutationId);
    const response = await request(bot ? "/api/v1/bot/documents/upload" : "/api/finance/documents/upload", bot ? undefined : actor,
      { method: "POST", body: form, headers: bot ? { Authorization: "Bearer " + bot.token, "x-acting-user": bot.actorId ?? actor?.id ?? "" } : undefined });
    const row = await pg.db.financeDocument.findUnique({ where: { clientMutationId: input.clientMutationId } });
    if (row) { assert.ok(row.uploadedById.startsWith(`ci169-${target.runId}-${target.attempt}-${scenarioId}-`)); assert.match(row.storageKey, /^finance-documents\/[0-9a-f-]{36}\/[a-f0-9]{64}$/); documents.add(row.storageKey); }
    return { response, body: await response.json() as { ok?: boolean; document?: FinanceDocumentView; repeated?: boolean; code?: string } };
  }
  return { ...pg, project, cookie, request, faultRequest, session, login, actionResponse, action, fault, put, get, versions, deleteMarker, file, upload, financeUpload,
    async dispose() { s3.destroy(); await pg.dispose(); } };
}

export function assertPrivateFileHeaders(response: Response, disposition: "inline" | "attachment") {
  assert.match(response.headers.get("content-disposition") ?? "", new RegExp(`^${disposition}(?:;|$)`));
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-security-policy"), "sandbox");
  assert.ok(response.headers.get("cache-control")?.startsWith("private"));
  assert.ok(response.headers.get("vary")?.split(/,\s*/).includes("Cookie"));
}
export function acceptedSketch(reply: UploadReply, mutation: string) {
  assert.equal(reply.response.status, 200); assert.equal(reply.body.ok, true);
  assert.equal(typeof reply.body.id, "string"); assert.equal(reply.body.sketchFileId, reply.body.id);
  assert.equal(reply.body.sketch?.id, reply.body.id); assert.equal(reply.body.clientMutationId, mutation);
  return reply.body.id!;
}
