// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при несовпадении guard.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { File as FileRow, User } from "@prisma/client";
import { DeleteObjectCommand, GetBucketVersioningCommand, GetObjectCommand, ListObjectVersionsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { encode } from "next-auth/jwt";
import { assertCiRuntimeTarget } from "./runtime/target.mjs";
import { createPostgresFixture } from "./postgres.fixture";

export type HttpActor = Pick<User, "id" | "name" | "email" | "roles" | "sessionVersion">;
export type UploadReply = { response: Response; body: { ok?: boolean; id?: string; sketchFileId?: string; clientMutationId?: string; repeated?: boolean; kind?: string; sketch?: { id: string }; error?: string } };

export async function createHttpS3Fixture(scenarioId: string) {
  const target = assertCiRuntimeTarget();
  const pg = await createPostgresFixture(scenarioId);
  const s3 = new S3Client({ endpoint: target.s3.endpoint, region: "us-east-1", forcePathStyle: true,
    credentials: { accessKeyId: target.s3.accessKeyId, secretAccessKey: target.s3.secretAccessKey }, maxAttempts: 1 });
  const bucket = target.s3.bucket, projects = new Set<string>();
  const ownedKey = (key: string) => {
    assert.ok(projects.has(key.split("/")[0]), "Только ключ собственного CI-проекта");
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
  async function session(actor: HttpActor) {
    const response = await request("/api/auth/session", actor);
    assert.equal(response.status, 200);
    const body = await response.json() as { user?: { id?: string; roles?: string[] } };
    assert.equal(body.user?.id, actor.id); assert.deepEqual(body.user?.roles, actor.roles);
  }
  async function put(key: string, bytes: Uint8Array, contentType: string) {
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
  async function versions(projectId: string) {
    assert.ok(projects.has(projectId));
    const result = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: `${projectId}/`, MaxKeys: 1000 }));
    assert.notEqual(result.IsTruncated, true, "Синтетический case должен оставаться bounded");
    return [
      ...(result.Versions ?? []).map(row => ({ key: row.Key!, versionId: row.VersionId!, marker: false, latest: row.IsLatest!, etag: row.ETag!, size: row.Size! })),
      ...(result.DeleteMarkers ?? []).map(row => ({ key: row.Key!, versionId: row.VersionId!, marker: true, latest: row.IsLatest!, etag: "", size: 0 })),
    ].sort((a, b) => `${a.key}/${a.versionId}`.localeCompare(`${b.key}/${b.versionId}`));
  }
  async function file(label: string, context: Pick<FileRow, "projectId" | "productId">, bytes: Uint8Array, mimeType: string,
    options: { hasThumb?: boolean; missing?: boolean; uploadedById?: string | null; fileName?: string } = {}) {
    const storedName = `${randomUUID()}-${label}`, key = `${context.projectId}/${storedName}`;
    if (!options.missing) await put(key, bytes, mimeType);
    return pg.db.file.create({ data: { id: pg.id(label), ...context, storedName, mimeType, size: bytes.length,
      fileName: options.fileName ?? label, section: "PRODUCTION", hasThumb: options.hasThumb ?? false,
      uploadedById: options.uploadedById ?? null } });
  }
  async function upload(actor: HttpActor | undefined, input: { projectId: string; productId: string; fileName: string; bytes: Uint8Array;
    clientMutationId: string; expectedSketchFileId?: string | null; mimeType?: string }): Promise<UploadReply> {
    assert.ok(projects.has(input.projectId));
    const form = new FormData(); form.append("file", new File([new Uint8Array(input.bytes)], input.fileName, { type: input.mimeType ?? "image/png" }));
    for (const [key, value] of Object.entries({ projectId: input.projectId, productId: input.productId, section: "PRODUCTION", clientMutationId: input.clientMutationId })) form.append(key, value);
    if (input.expectedSketchFileId !== undefined) { form.append("assignCover", "1"); form.append("expectedSketchFileId", input.expectedSketchFileId ?? "null"); }
    const response = await request("/api/files/upload", actor, { method: "POST", body: form });
    return { response, body: await response.json() as UploadReply["body"] };
  }
  return { ...pg, project, cookie, request, session, put, get, versions, deleteMarker, file, upload,
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
