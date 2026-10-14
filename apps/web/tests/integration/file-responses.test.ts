import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { verifiedRollback } from "../helpers/native-acceptance-snapshot";
import { assertCiRuntimeTarget } from "./runtime/target.mjs";
import sharp from "sharp";
import { assertPrivateFileHeaders, createHttpS3Fixture } from "./http-s3.fixture";
import { hashPassword } from "../../src/lib/password";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
// Ожидания перенесены из safe-file-response.test.ts и image-preview.test.ts; не вычисляются кодом route.
const active = [
  { label: "html", mime: "text/html", bytes: Buffer.from("<!doctype html><title>inert fixture</title><p>fixture</p>") },
  { label: "svg", mime: "image/svg+xml", bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>') },
] as const;
const deniedUrls = ["", "?view=1", "?thumb=1", "?view=1&thumb=1", "?preview=cover", "?preview=thumbnail&thumb=1"];

test("media.responses: настоящий Next.js, Auth.js и versioned MinIO", { timeout: 180_000 }, async t => {
  const f = await createHttpS3Fixture("media-responses"); t.after(() => f.dispose());
  const engineer = await f.user("engineer", ["ENGINEER"]), foreign = await f.user("foreign", ["ENGINEER"]);
  await f.session(engineer); await f.session(foreign);
  const project = await f.project("media", { stage: "CONTRACT", currency: "BYN" }), product = await f.product("design", project.id, { status: "DESIGN", engineerId: engineer.id });
  const production = await f.product("production", project.id, { status: "PRODUCTION", engineerId: engineer.id });
  const context = { projectId: project.id, productId: product.id };
  const png = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: "#4488aa" } }).png().toBuffer();
  const pdf = Buffer.from("%PDF-1.4\nfixture\n%%EOF");
  const sources = [...active, { label: "png", mime: "image/png", bytes: png }, { label: "pdf", mime: "application/pdf", bytes: pdf },
    { label: "corrupt", mime: "image/png", bytes: Buffer.from("not a raster image") }];
  const files: { source: (typeof sources)[number]; row: Awaited<ReturnType<typeof f.file>> }[] = [];
  for (const hasThumb of [false, true]) {
    for (const source of sources) {
      const row = await f.file(`${source.label}-${hasThumb}`, context, source.bytes, source.mime, { hasThumb });
      if (hasThumb) await f.put(`${project.id}/thumbs/${row.storedName}.jpg`, active[0].bytes, "text/html");
      files.push({ source, row });
    }
  }
  const missing = await f.file("missing", context, png, "image/png", { missing: true, hasThumb: true });
  const productionFile = await f.file("production", { projectId: project.id, productId: production.id }, png, "image/png");
  const originals = await f.versions(project.id), rowsBefore = await f.db.file.findMany({ where: { projectId: project.id }, orderBy: { id: "asc" } });
  const read = (id: string, suffix = "", actor = engineer, headers?: HeadersInit) => f.request(`/api/files/${id}${suffix}`, actor, { headers });

  await t.test("media.active: HTML/SVG attachment byte-exact; legacy thumb415 независимо от hasThumb", async () => {
    for (const { source, row } of files.filter(item => item.source.label === "html" || item.source.label === "svg")) {
      for (const suffix of ["", "?view=1"]) {
        const response = await read(row.id, suffix); assert.equal(response.status, 200);
        assertPrivateFileHeaders(response, "attachment"); assert.equal(response.headers.get("content-type"), source.mime);
        assert.equal(hash(new Uint8Array(await response.arrayBuffer())), hash(source.bytes));
      }
      for (const suffix of ["?thumb=1", "?thumb=1&view=1", "?preview=thumbnail&thumb=1&view=1"]) {
        const response = await read(row.id, suffix); assert.equal(response.status, 415); assert.equal(response.headers.get("content-disposition"), null);
      }
    }
  });
  await t.test("media.raster: оригинал неизменен; thumbnail/card/cover безопасны и bounded", async () => {
    for (const { row } of files.filter(item => item.source.label === "png")) {
      for (const suffix of ["", "?view=1"]) {
        const response = await read(row.id, suffix); assert.equal(response.status, 200); assertPrivateFileHeaders(response, "attachment");
        assert.equal(hash(new Uint8Array(await response.arrayBuffer())), hash(png));
        assert.match(response.headers.get("content-disposition")!, new RegExp(`filename\\*=UTF-8''${encodeURIComponent(row.fileName)}`));
      }
      for (const [suffix, maxWidth, maxHeight] of [["?thumb=1", 160, 160], ["?thumb=1&view=1", 160, 160],
        ["?preview=thumbnail", 160, 160], ["?preview=card", 480, 480], ["?preview=cover&thumb=1", 1280, 1600]] as const) {
        const response = await read(row.id, suffix); assert.equal(response.status, 200); assertPrivateFileHeaders(response, "inline");
        assert.equal(response.headers.get("content-type"), "image/webp");
        const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata(); assert.equal(metadata.format, "webp");
        assert.ok(metadata.width! > 0 && metadata.width! <= maxWidth && metadata.height! > 0 && metadata.height! <= maxHeight);
        assert.ok(Math.abs(metadata.height! - metadata.width! * 3 / 4) <= 1);
        if (suffix.includes("cover")) assert.ok(metadata.width! > 480, "preview имеет приоритет перед legacy thumb");
      }
    }
  });
  await t.test("media.corrupt-missing: corrupt422 и missing404 без inline fallback", async () => {
    for (const { source, row } of files.filter(item => item.source.label === "corrupt")) {
      for (const suffix of ["?thumb=1", "?thumb=1&view=1", "?preview=cover&thumb=1"]) {
        const response = await read(row.id, suffix); assert.equal(response.status, 422); assert.equal(response.headers.get("content-disposition"), null);
      }
      const response = await read(row.id); assertPrivateFileHeaders(response, "attachment");
      assert.equal(hash(new Uint8Array(await response.arrayBuffer())), hash(source.bytes));
    }
    for (const suffix of ["", "?thumb=1", "?preview=cover"]) {
      const response = await read(missing.id, suffix); assert.equal(response.status, 404); assert.equal(response.headers.get("content-disposition"), null);
    }
  });
  await t.test("media.pdf: inline только при view; thumbnail415", async () => {
    for (const { row } of files.filter(item => item.source.label === "pdf")) {
      for (const suffix of ["", "?view=1"]) {
        const response = await read(row.id, suffix); assert.equal(response.status, 200); assertPrivateFileHeaders(response, suffix ? "inline" : "attachment");
        assert.equal(response.headers.get("content-type"), "application/pdf"); assert.equal(hash(new Uint8Array(await response.arrayBuffer())), hash(pdf));
      }
      for (const suffix of ["?thumb=1", "?view=1&thumb=1"]) assert.equal((await read(row.id, suffix)).status, 415);
    }
  });
  await t.test("media.retired-caption: старые формы422 сохраняют настоящие строки и S3-версии", async () => {
    for (const cover of [false, true]) for (const caption of ["", "legacy caption", new File(["caption"], "caption.txt")]) {
      const form = new FormData(); form.append("file", new File([png], "obsolete.png", { type: "image/png" }));
      for (const [key, value] of Object.entries({ projectId: project.id, productId: product.id, section: "PRODUCTION", clientMutationId: randomUUID(),
        ...(cover ? { assignCover: "1", expectedSketchFileId: "null" } : {}) })) form.append(key, value);
      form.append("caption", caption);
      assert.equal((await f.request("/api/files/upload", engineer, { method: "POST", body: form })).status, 422);
    }
    assert.deepEqual(await f.db.file.findMany({ where: { projectId: project.id }, orderBy: { id: "asc" } }), rowsBefore);
    assert.deepEqual(await f.versions(project.id), originals);
  });
  await t.test("media.access: current production ENGINEER200, foreign404, anonymous middleware307", async () => {
    const hiddenProject = await f.project("hidden-engineering"), hidden = await f.product("hidden-engineering", hiddenProject.id, { status: "DESIGN", engineerId: foreign.id });
    assert.equal((await f.request("/products/" + product.number, engineer)).status, 200);
    assert.equal((await f.request("/products/" + hidden.number, engineer)).status, 404);
    for (const item of [product, hidden]) {
      const response = await f.request("/api/search?q=" + encodeURIComponent(item.number), engineer); assert.equal(response.status, 200);
      const result = await response.json() as { products: { id: string }[]; projects: { id: string }[]; tasks: { id: string }[] };
      assert.ok(result.products.every(row => [product.id, production.id].includes(row.id)));
      assert.ok(result.projects.every(row => row.id === project.id)); assert.deepEqual(result.tasks, []);
      if (item.id === product.id) assert.ok(result.products.some(row => row.id === product.id));
      assert.ok(!result.products.some(row => row.id === hidden.id)); assert.ok(!result.projects.some(row => row.id === hiddenProject.id));
    }
    const searchMarker = f.id("eligible-search"), searchWork = await f.db.work.create({ data: { id: f.id("eligible-search-work"),
      projectId: project.id, productId: product.id, title: searchMarker, quantity: "7", priceSnapshot: "1", total: "7" } });
    const foreignWork = await f.db.work.create({ data: { id: f.id("hidden-search-work"), projectId: hiddenProject.id,
      productId: hidden.id, title: searchMarker, quantity: "1", priceSnapshot: "1", total: "1" } });
    const expectedTaskIds = Array.from({ length: 7 }, (_, index) => f.id("eligible-search-" + index));
    const orphanId = f.id("search-orphan"), foreignTaskId = f.id("search-foreign");
    await f.db.task.createMany({ data: [
      ...expectedTaskIds.map((id, index) => ({ id, projectId: project.id, productId: product.id, workId: searchWork.id,
        assigneeId: engineer.id, title: searchMarker + index, status: "NEW" as const, quantity: "1", updatedAt: new Date(Date.UTC(2026, 9, 7, 12, 0, 7 - index)) })),
      { id: orphanId, projectId: project.id, productId: product.id, assigneeId: engineer.id, title: searchMarker,
        status: "NEW", updatedAt: new Date("2026-10-07T12:00:20Z") },
      { id: foreignTaskId, projectId: hiddenProject.id, productId: hidden.id, workId: foreignWork.id, assigneeId: foreign.id,
        title: searchMarker, status: "NEW", quantity: "1", updatedAt: new Date("2026-10-07T12:00:21Z") },
    ] });
    const taskSearch = await f.request("/api/search?q=" + encodeURIComponent(searchMarker), engineer); assert.equal(taskSearch.status, 200);
    const searchedTasks = (await taskSearch.json() as { tasks: { id: string }[] }).tasks;
    assert.deepEqual(searchedTasks.map(row => row.id), expectedTaskIds.slice(0, 6)); assert.ok(!searchedTasks.some(row => [orphanId, foreignTaskId].includes(row.id)));
    const image = files.find(item => item.source.label === "png")!.row;
    for (const suffix of deniedUrls) {
      const allowed = await read(productionFile.id, suffix); assert.equal(allowed.status, 200); await allowed.arrayBuffer();
      const denied = await read(image.id, suffix, foreign); assert.equal(denied.status, 404); assert.equal(denied.headers.get("etag"), null);
      assert.deepEqual(await denied.json(), { error: "Файл не найден" });
      const anonymous = await f.request(`/api/files/${image.id}${suffix}`); assert.equal(anonymous.status, 307);
      assert.equal(new URL(anonymous.headers.get("location")!, f.target.baseUrl).pathname, "/login");
      assert.notEqual(hash(new Uint8Array(await anonymous.arrayBuffer())), hash(png));
    }
  });
  await t.test("media.cache: 304 без body, preview priority400 и отзыв ACL до warm ETag", async () => {
    const image = files.find(item => item.source.label === "png")!.row;
    const first = await read(image.id, "?thumb=1"); const etag = first.headers.get("etag"); assert.ok(etag); await first.arrayBuffer();
    const unchanged = await read(image.id, "?thumb=1", engineer, { "if-none-match": etag });
    assert.equal(unchanged.status, 304); assert.equal(unchanged.body, null); assert.equal(unchanged.headers.get("content-length"), null);
    assert.equal(unchanged.headers.get("cache-control"), "private, max-age=0, must-revalidate");
    assert.ok(unchanged.headers.get("vary")?.split(/,\s*/).includes("Cookie"));
    assert.equal((await read(image.id, "?preview=unknown&thumb=1")).status, 400);
    await f.db.product.update({ where: { id: product.id }, data: { engineerId: foreign.id } });
    const revoked = await read(image.id, "?thumb=1", engineer, { "if-none-match": etag });
    assert.equal(revoked.status, 404); assert.equal(revoked.headers.get("etag"), null);
  });
  assert.deepEqual(await f.versions(project.id), originals, "GET и previews не изменяют ни одну S3-версию");
  for (const { source, row } of files) assert.equal(hash(await f.get(`${project.id}/${row.storedName}`)), hash(source.bytes));
  assert.deepEqual(await f.db.file.findMany({ where: { projectId: project.id }, orderBy: { id: "asc" } }), rowsBefore);
  await f.verifyProtected();
});

test("security.routes: credentials, Bearer, Telegram и команды через настоящий Next.js/PostgreSQL", { timeout: 180_000 }, async t => {
  const f = await createHttpS3Fixture("security-routes"); t.after(() => f.dispose());
  const password = "Ci169-password-not-for-real-users", initialHash = await hashPassword(password), changedHash = await hashPassword(`${password}-changed`);
  const passwordUser = async (label: string, active = true) => {
    const row = await f.user(label, ["ENGINEER"], { active });
    return f.db.user.update({ where: { id: row.id }, data: { passwordHash: initialHash } });
  };
  const session = async (cookie: string) => {
    const response = await f.request("/api/auth/session", undefined, { headers: { cookie } }); assert.equal(response.status, 200);
    return { response, body: await response.json() as { user?: { id: string; roles: string[] } } | null };
  };
  const owner = await f.user("plugin-owner", ["MANAGER"]);
  const token = async (label: string, scopes: string[], createdById: string | null = owner.id) => {
    const raw = `pero_${randomUUID().replaceAll("-", "")}`;
    const row = await f.db.apiToken.create({ data: { id: f.id(label), name: label, prefix: raw.slice(0, 11), tokenHash: hash(Buffer.from(raw)), scopes, createdById } });
    return { raw, row };
  };
  const none = await token("none", []), admin = await token("admin", ["admin"]);
  let read = await token("read", ["read"]), write = await token("write", ["write"]);
  const api = (path: string, raw: string | undefined, method = "GET", body?: object) => f.request(path, undefined, {
    method, headers: { ...(raw ? { Authorization: `Bearer ${raw}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  await t.test("credentials/login: пароль проверяется настоящим provider; unknown/wrong/inactive отказ", async () => {
    const target = assertCiRuntimeTarget();
    const { Client } = createRequire(import.meta.url)("pg") as { Client: new (options: { connectionString: string }) => {
      connect(): Promise<void>; query(sql: string): Promise<{ rows: Record<string, unknown>[] }>; end(): Promise<void>;
    } };
    const client = new Client({ connectionString: target.databaseUrl }), schema = "ci169_auth_" + randomUUID().replaceAll("-", "");
    assert.match(schema, /^ci169_auth_[a-f0-9]{32}$/); let begun = false;
    await verifiedRollback(async () => {
      await client.connect(); assert.equal((await client.query("SELECT current_database() AS name")).rows[0].name, "pero_ci");
      await client.query("BEGIN"); begun = true;
      await client.query('CREATE SCHEMA "' + schema + '"; SET LOCAL search_path TO "' + schema + '", public');
      assert.equal((await client.query("SELECT current_schema() AS name")).rows[0].name, schema);
      await client.query('CREATE TABLE "User" (id text PRIMARY KEY, email text UNIQUE NOT NULL, name text, "passwordHash" text NOT NULL, roles text[] NOT NULL, active boolean NOT NULL); CREATE TABLE "ApiToken" (id text PRIMARY KEY, "createdById" text, "revokedAt" timestamptz)');
      await client.query(`INSERT INTO "User" VALUES ('a','a@test.invalid','Test A','hash1',ARRAY['ADMIN'],true),('b','b@test.invalid','Test B','hash1',ARRAY['MANAGER'],true),('disabled','disabled@test.invalid','Disabled','hash1',ARRAY['WORKER'],false); INSERT INTO "ApiToken" (id,"createdById") VALUES ('disabled-token','disabled'),('orphan-token','missing'),('service-token',NULL),('a-token','a'),('b-token','b')`);
      await client.query(await readFile(new URL("../../prisma/migrations/20260922160000_session_revocation/migration.sql", import.meta.url), "utf8"));
      assert.equal((await client.query(`SELECT "sessionVersion" FROM "User" WHERE id='a'`)).rows[0].sessionVersion, 0);
      const revoked = (await client.query('SELECT id, "revokedAt" IS NOT NULL AS revoked FROM "ApiToken" ORDER BY id')).rows;
      assert.deepEqual(revoked, [{ id: "a-token", revoked: false }, { id: "b-token", revoked: false }, { id: "disabled-token", revoked: true }, { id: "orphan-token", revoked: true }, { id: "service-token", revoked: false }]);
    }, async () => { try { if (begun) await client.query("ROLLBACK"); } finally { await client.end(); } });
    const fieldActor = await f.user("task-page-field", ["WORKER"]), officeActor = await f.user("task-page-office", ["MANAGER"]);
    const fieldPage = await f.request("/tasks", fieldActor); assert.ok([302, 307].includes(fieldPage.status));
    assert.equal(new URL(fieldPage.headers.get("location")!, f.target.baseUrl).pathname, "/my");
    assert.equal((await f.request("/tasks", officeActor)).status, 200);
    const active = await passwordUser("login-active"), inactive = await passwordUser("login-inactive", false);
    const logged = await f.login(active.email, password); assert.equal(new URL(logged.url).searchParams.has("error"), false);
    assert.equal((await session(logged.cookie)).body?.user?.id, active.id);
    for (const [email, value] of [[`${f.id("unknown")}@example.invalid`, password], [active.email, `${password}-wrong`], [inactive.email, password]]) {
      const failed = await f.login(email, value); assert.equal(new URL(failed.url).searchParams.get("error"), "CredentialsSignin");
      assert.equal((await session(failed.cookie)).body, null);
    }
  });
  await t.test("credentials/revoke: реальные password/roles/email/active/manual записи отзывают выданную cookie", async () => {
    const independent = await passwordUser("independent"), unaffected = await f.login(independent.email, password);
    for (const reason of ["password", "roles", "email", "active", "manual"] as const) {
      const user = await passwordUser(`revoke-${reason}`), logged = await f.login(user.email, password);
      const personal = await token(`revoke-${reason}-token`, ["read"], user.id);
      assert.equal((await session(logged.cookie)).body?.user?.id, user.id);
      const changed = await f.db.user.update({ where: { id: user.id }, data: reason === "password" ? { passwordHash: changedHash }
        : reason === "roles" ? { roles: ["WORKER"] } : reason === "email" ? { email: `${f.id("changed-email")}@example.invalid` }
        : reason === "active" ? { active: false } : { sessionVersion: { increment: 1 } } });
      assert.equal(changed.sessionVersion, user.sessionVersion + 1, reason);
      if (reason === "active") await f.db.user.update({ where: { id: user.id }, data: { active: true } });
      const revoked = await session(logged.cookie); assert.equal(revoked.body, null, reason);
      assert.match(revoked.response.headers.get("set-cookie") ?? "", /Max-Age=0/);
      const apiStatus = await api("/api/v1/plugins", personal.raw);
      const revokeApi = reason === "roles" || reason === "active";
      assert.equal(apiStatus.status, revokeApi ? 401 : 200, reason);
      assert.equal((await f.db.apiToken.findUniqueOrThrow({ where: { id: personal.row.id } })).revokedAt !== null, revokeApi, reason);
      for (const path of ["/api/search?q=security", "/api/files/missing-owned-fixture"]) {
        const hidden = await f.request(path, undefined, { headers: { cookie: logged.cookie } });
        assert.ok([401, 403, 307].includes(hidden.status), `REVOKED_COOKIE_NO_ROUTE_DATA:${path}`);
      }
      const denied = await f.request("/my", undefined, { headers: { cookie: logged.cookie } }); assert.equal(denied.status, 307);
      assert.equal(new URL(denied.headers.get("location")!, f.target.baseUrl).pathname, "/login");
    }
    assert.equal((await session(unaffected.cookie)).body?.user?.id, independent.id);
  });
  await t.test("credentials/monotonic-noop-token-owner: rewind, пароль, удалённый владелец и чужая сессия", async () => {
    const user = await passwordUser("monotonic"), logged = await f.login(user.email, password);
    const personal = await token("monotonic-token", ["read"], user.id), service = await token("monotonic-service", ["read"], null);
    const path = "/api/v1/plugins", unchanged = await f.db.user.update({ where: { id: user.id }, data: { name: "Новое имя", passwordHash: initialHash } });
    assert.equal(unchanged.sessionVersion, user.sessionVersion); assert.equal((await session(logged.cookie)).body?.user?.id, user.id);
    const changed = await f.db.user.update({ where: { id: user.id }, data: { passwordHash: changedHash } });
    assert.equal(changed.sessionVersion, user.sessionVersion + 1); assert.equal((await session(logged.cookie)).body, null);
    assert.equal((await api(path, personal.raw)).status, 200, "PASSWORD_ONLY_PRESERVES_API_CREDENTIAL");
    const rewind = await f.db.user.update({ where: { id: user.id }, data: { sessionVersion: user.sessionVersion } });
    assert.equal(rewind.sessionVersion, changed.sessionVersion); assert.equal((await session(logged.cookie)).body, null);
    const noop = await f.db.user.update({ where: { id: user.id }, data: { passwordHash: changedHash } });
    assert.equal(noop.sessionVersion, changed.sessionVersion);
    const current = await f.login(user.email, `${password}-changed`), independent = await passwordUser("delete-independent"), other = await f.login(independent.email, password);
    await f.db.user.delete({ where: { id: user.id } });
    assert.equal((await session(current.cookie)).body, null); assert.equal((await api(path, personal.raw)).status, 401);
    await f.db.apiToken.update({ where: { id: personal.row.id }, data: { createdById: null } });
    assert.ok((await f.db.apiToken.findUniqueOrThrow({ where: { id: personal.row.id } })).revokedAt);
    assert.equal((await api(path, personal.raw)).status, 401); assert.equal((await api(path, service.raw)).status, 200);
    assert.equal((await session(other.cookie)).body?.user?.id, independent.id);
  });
  await t.test("credentials/owned-web-db-fault: health503, auth fail-closed и сохранённая cookie после recovery", async () => {
    const user = await passwordUser("outage"), logged = await f.login(user.email, password), before = await f.db.user.findUniqueOrThrow({ where: { id: user.id } });
    const healthy = await f.request("/api/health"); assert.equal(healthy.status, 200);
    const fault = await f.faultRequest("/api/health"); assert.equal(fault.status, 503); assert.equal(fault.headers.get("cache-control"), "no-store");
    const body = await fault.json() as { status: string; database: string; checkedAt: string };
    assert.equal(body.status, "degraded"); assert.equal(body.database, "unavailable"); assert.ok(Number.isFinite(Date.parse(body.checkedAt)));
    const rejected = await f.faultRequest("/api/auth/session", undefined, { headers: { cookie: logged.cookie } });
    assert.equal(rejected.status, 200); assert.equal(await rejected.json(), null);
    const denied = await f.faultRequest("/my", undefined, { headers: { cookie: logged.cookie } }); assert.equal(denied.status, 307);
    assert.equal(new URL(denied.headers.get("location")!, f.target.faultBaseUrl).pathname, "/login");
    assert.equal((await f.request("/api/health")).status, 200); assert.equal((await session(logged.cookie)).body?.user?.id, user.id);
    assert.deepEqual(await f.db.user.findUniqueOrThrow({ where: { id: user.id } }), before, "FAULT_WEB_CANNOT_MUTATE_HEALTHY_DATABASE");
  });
  await t.test("bearer/scopes: реальные read/write/admin, absent/unknown/revoked/inactive токены", async () => {
    const path = "/api/v1/plugins", inactive = await f.user("inactive-token-owner", ["MANAGER"], { active: false });
    const disabledOwner = await token("inactive-token", ["read", "write"], inactive.id), revoked = await token("revoked-token", ["read", "write"]);
    await f.db.apiToken.update({ where: { id: revoked.row.id }, data: { revokedAt: new Date() } });
    for (const raw of [undefined, "pero_unknown", revoked.raw, disabledOwner.raw]) {
      assert.equal((await api(path, raw)).status, 401);
      assert.equal((await api("/api/v1/plugins/demo/commands/ping", raw, "POST")).status, 401);
    }
    for (const [key, status] of [[none, 403], [write, 403], [read, 200], [admin, 200]] as const) assert.equal((await api(path, key.raw)).status, status);
    for (const key of [none, read]) assert.equal((await api("/api/v1/plugins/demo/commands/ping", key.raw, "POST")).status, 403);
    const personal = await token("personal-token", ["read"]), service = await token("service-token", ["read"], null);
    assert.equal((await api(path, personal.raw)).status, 200);
    await f.db.user.update({ where: { id: owner.id }, data: { active: false } });
    await f.db.user.update({ where: { id: owner.id }, data: { active: true } });
    assert.ok((await f.db.apiToken.findUniqueOrThrow({ where: { id: personal.row.id } })).revokedAt);
    assert.equal((await api(path, personal.raw)).status, 401); assert.equal((await api(path, service.raw)).status, 200);
    for (const key of [read, write, admin]) assert.equal((await api(path, key.raw)).status, 401);
    read = await token("new-read", ["read"]); write = await token("new-write", ["write"]);
  });
  await t.test("telegram/link-session-unlink: expiry/occupied/inactive/replay и разрешённая привязка ENGINEER", async () => {
    const engineer = await f.user("telegram-engineer", ["ENGINEER"]), disabled = await f.user("telegram-disabled", ["MANAGER"], { active: false });
    const occupied = f.id("occupied-chat"), chatId = f.id("engineer-chat");
    await f.db.telegramLink.create({ data: { userId: owner.id, chatId: occupied, linkedAt: new Date() } });
    const link = await f.db.telegramLink.create({ data: { userId: engineer.id, linkCode: f.id("valid-code"), linkCodeExpiresAt: new Date(Date.now() + 60_000) } });
    const expiredUser = await f.user("telegram-expired", ["MANAGER"]);
    const expired = await f.db.telegramLink.create({ data: { userId: expiredUser.id, linkCode: f.id("expired-code"), linkCodeExpiresAt: new Date(Date.now() - 60_000) } });
    const inactive = await f.db.telegramLink.create({ data: { userId: disabled.id, linkCode: f.id("inactive-code"), linkCodeExpiresAt: new Date(Date.now() + 60_000) } });
    const baseline = await f.db.telegramLink.findMany({ orderBy: { id: "asc" } });
    for (const [path, method, body, wrong] of [
      ["/api/v1/bot/link", "POST", { code: link.linkCode, chatId }, read],
      ["/api/v1/bot/unlink", "DELETE", { chatId }, read],
      [`/api/v1/bot/session?chatId=${encodeURIComponent(chatId)}`, "GET", undefined, write],
    ] as const) {
      assert.equal((await api(path, undefined, method, body)).status, 401);
      assert.equal((await api(path, wrong.raw, method, body)).status, 403);
    }
    for (const [code, target, status] of [[f.id("unknown-code"), chatId, 400], [expired.linkCode!, chatId, 400], [inactive.linkCode!, chatId, 403], [link.linkCode!, occupied, 400]] as const) {
      assert.equal((await api("/api/v1/bot/link", write.raw, "POST", { code, chatId: target })).status, status);
      assert.deepEqual(await f.db.telegramLink.findMany({ orderBy: { id: "asc" } }), baseline);
    }
    const linked = await api("/api/v1/bot/link", write.raw, "POST", { code: link.linkCode, chatId, username: "fixture" }); assert.equal(linked.status, 200);
    assert.deepEqual((await linked.json()).user, { id: engineer.id, name: engineer.name, roles: ["ENGINEER"], botAllowed: false });
    const saved = await f.db.telegramLink.findUniqueOrThrow({ where: { userId: engineer.id } });
    assert.equal(saved.chatId, chatId); assert.equal(saved.linkCode, null); assert.equal(saved.linkCodeExpiresAt, null); assert.ok(saved.linkedAt);
    assert.equal((await api("/api/v1/bot/link", write.raw, "POST", { code: link.linkCode, chatId })).status, 400);
    const found = () => api(`/api/v1/bot/session?chatId=${encodeURIComponent(chatId)}`, read.raw);
    assert.equal((await (await found()).json()).found, true);
    await f.db.user.update({ where: { id: engineer.id }, data: { active: false } }); assert.equal((await (await found()).json()).found, false);
    await f.db.user.update({ where: { id: engineer.id }, data: { active: true } });
    const unlinked = await api("/api/v1/bot/unlink", write.raw, "DELETE", { chatId }); assert.equal(unlinked.status, 200);
    assert.deepEqual(await unlinked.json(), { ok: true, deleted: 1 }); assert.equal((await (await found()).json()).found, false);
    assert.equal(await f.db.telegramLink.findUnique({ where: { userId: engineer.id } }), null);
  });
  await t.test("plugins/commands: 404/disabled409, настоящий ping и error500 с run-log", async () => {
    const original = await f.db.plugin.findUniqueOrThrow({ where: { id: "demo" } }), settings = await f.db.pluginSetting.findMany({ where: { pluginId: "demo" }, orderBy: { key: "asc" } });
    const command = (key = "ping", id = "demo") => api(`/api/v1/plugins/${id}/commands/${key}`, write.raw, "POST");
    try {
      await f.db.plugin.update({ where: { id: "demo" }, data: { enabled: false, name: f.id("demo-plugin") } });
      const logsBefore = await f.db.pluginRunLog.findMany({ where: { pluginId: "demo" }, orderBy: { id: "asc" } });
      assert.equal((await command("unknown")).status, 404); assert.equal((await command("ping", "unknown")).status, 404);
      assert.equal((await command()).status, 409); assert.deepEqual(await f.db.pluginRunLog.findMany({ where: { pluginId: "demo" }, orderBy: { id: "asc" } }), logsBefore);
      await f.db.plugin.update({ where: { id: "demo" }, data: { enabled: true } });
      const auditBefore = await f.db.changeLog.count({ where: { actorId: "plugin:demo", action: "command.ping" } }), eventBefore = await f.db.domainEvent.count({ where: { actor: "plugin:demo", type: "demo.ping" } });
      const success = await command(); assert.equal(success.status, 200); assert.equal((await success.json()).ok, true);
      assert.equal(await f.db.changeLog.count({ where: { actorId: "plugin:demo", action: "command.ping" } }), auditBefore + 1);
      assert.equal(await f.db.domainEvent.count({ where: { actor: "plugin:demo", type: "demo.ping" } }), eventBefore + 1);
      await f.fault("ChangeLog", "plugin:demo", async () => {
        const failed = await command(); assert.equal(failed.status, 500); assert.equal((await failed.json()).ok, false);
      }, owner.id);
      const logs = await f.db.pluginRunLog.findMany({ where: { pluginId: "demo", kind: "api", ref: "command:ping", id: { notIn: logsBefore.map(row => row.id) } }, orderBy: { createdAt: "asc" } });
      assert.equal(logs.length, 2); assert.deepEqual(logs.map(row => [row.kind, row.ref, row.status]), [["api", "command:ping", "ok"], ["api", "command:ping", "error"]]);
      assert.ok(logs.every(row => typeof row.durationMs === "number" && row.durationMs >= 0)); assert.match(logs[1].message!, /CI169_EXPECTED_FAULT/);
      assert.equal(await f.db.changeLog.count({ where: { actorId: "plugin:demo", action: "command.ping" } }), auditBefore + 1);
      assert.equal(await f.db.domainEvent.count({ where: { actor: "plugin:demo", type: "demo.ping" } }), eventBefore + 1);
      assert.deepEqual(await f.db.pluginSetting.findMany({ where: { pluginId: "demo" }, orderBy: { key: "asc" } }), settings);
    } finally {
      const { id, ...data } = original; await f.db.plugin.update({ where: { id }, data });
      assert.deepEqual(await f.db.plugin.findUnique({ where: { id } }), original);
    }
  });
  await t.test("calendar/http-duration-totals-analytics-own-only-and-disabled", async () => {
    const own = await f.user("calendar-http", ["PROCUREMENT"], { calendarEnabled: true });
    const other = await f.user("calendar-http-other", ["ADMIN"], { calendarEnabled: true });
    await f.db.calendarEntry.createMany({ data: [
      { id: randomUUID(), ownerId: own.id, title: "Часы 90", startsAt: new Date("2026-10-07T06:00Z"), plannedMinutes: 90, reminderOffsetMinutes: null },
      { id: randomUUID(), ownerId: own.id, title: "Не указана", startsAt: new Date("2026-10-07T07:00Z"), plannedMinutes: null, reminderOffsetMinutes: null },
      { id: randomUUID(), ownerId: own.id, title: "Ноль", startsAt: new Date("2026-10-07T08:00Z"), plannedMinutes: 0, reminderOffsetMinutes: null },
      { id: randomUUID(), ownerId: other.id, title: "FOREIGN_CALENDAR_SECRET", startsAt: new Date("2026-10-07T06:00Z"), plannedMinutes: 9999, reminderOffsetMinutes: null },
    ] });
    const durationPath = "/plan?date=2026-10-07", duration = await f.request(durationPath, own); assert.equal(duration.status, 200);
    const durationHtml = await duration.text();
    for (const value of ["Часы 90", "1 ч 30 мин", "Не указана", "0 ч"]) assert.ok(durationHtml.includes(value), value);
    for (const value of ["FOREIGN_CALENDAR_SECRET", own.passwordHash, other.passwordHash]) assert.ok(!durationHtml.includes(value));
    const adminHtml = await (await f.request(durationPath, other)).text(); assert.ok(adminHtml.includes("FOREIGN_CALENDAR_SECRET")); assert.ok(!adminHtml.includes("Часы 90"));
    const totalOwner = await f.user("calendar-report", ["PROCUREMENT"], { calendarEnabled: true });
    await f.db.calendarEntry.createMany({ data: [
      { id: randomUUID(), ownerId: totalOwner.id, title: "Начало месяца", startsAt: new Date("2026-09-30T21:00Z"), plannedMinutes: 30, reminderOffsetMinutes: null },
      { id: randomUUID(), ownerId: totalOwner.id, title: "Запланировано", startsAt: new Date("2026-10-07T06:00Z"), plannedMinutes: 90, reminderOffsetMinutes: null },
      { id: randomUUID(), ownerId: totalOwner.id, title: "Выполнено", startsAt: new Date("2026-10-07T07:00Z"), plannedMinutes: 60, state: "COMPLETED", reminderOffsetMinutes: null },
      { id: randomUUID(), ownerId: totalOwner.id, title: "Отменено", startsAt: new Date("2026-10-07T08:00Z"), plannedMinutes: 120, state: "CANCELLED", reminderOffsetMinutes: null },
      { id: randomUUID(), ownerId: totalOwner.id, title: "Пусто", startsAt: new Date("2026-10-07T09:00Z"), plannedMinutes: null, state: "COMPLETED", reminderOffsetMinutes: null },
      { id: randomUUID(), ownerId: totalOwner.id, title: "Ноль", startsAt: new Date("2026-10-07T10:00Z"), plannedMinutes: 0, reminderOffsetMinutes: null },
      { id: randomUUID(), ownerId: totalOwner.id, title: "OUTSIDE_BEFORE", startsAt: new Date("2026-09-30T20:59:59.999Z"), plannedMinutes: 999, reminderOffsetMinutes: null },
      { id: randomUUID(), ownerId: totalOwner.id, title: "OUTSIDE_AFTER", startsAt: new Date("2026-10-31T21:00Z"), plannedMinutes: 999, reminderOffsetMinutes: null },
    ] });
    const month = await f.request(durationPath, totalOwner); assert.equal(month.status, 200); const monthHtml = await month.text();
    for (const value of ["Часы за месяц", "Часы за день", "3 ч", "2 ч 30 мин", "Указанные плановые часы", "Плановые часы выполненных записей", "Без длительности:"]) assert.ok(monthHtml.includes(value), value);
    for (const value of ["OUTSIDE_BEFORE", "OUTSIDE_AFTER", "FOREIGN_CALENDAR_SECRET"]) assert.ok(!monthHtml.includes(value));
    assert.ok((await (await f.request("/plan?date=2026-12-01", totalOwner)).text()).includes("0 ч"));
    await f.db.calendarEntry.createMany({ data: [
      { id: randomUUID(), ownerId: totalOwner.id, title: "Начало диапазона", startsAt: new Date("2026-10-06T21:00Z"), plannedMinutes: 15, reminderOffsetMinutes: null },
      { id: randomUUID(), ownerId: totalOwner.id, title: "Конец диапазона", startsAt: new Date("2026-10-08T20:59:59.999Z"), plannedMinutes: 45, state: "COMPLETED", updatedAt: new Date("2026-11-01"), reminderOffsetMinutes: null },
      { id: randomUUID(), ownerId: totalOwner.id, title: "BEFORE_RANGE_SECRET", startsAt: new Date("2026-10-06T20:59:59.999Z"), plannedMinutes: 111, reminderOffsetMinutes: null },
      { id: randomUUID(), ownerId: totalOwner.id, title: "AFTER_RANGE_SECRET", startsAt: new Date("2026-10-08T21:00Z"), plannedMinutes: 111, reminderOffsetMinutes: null },
    ] });
    const analyticsPath = "/plan/analytics?from=2026-10-07&to=2026-10-08";
    const report = await f.request(analyticsPath + "&ownerId=" + other.id, totalOwner); assert.equal(report.status, 200); const html = await report.text();
    for (const value of ["Аналитика плана", "Итоги периода", "3 ч 30 мин", "1 ч 45 мин", "Начало диапазона", "Конец диапазона"]) assert.ok(html.includes(value), value);
    for (const value of ["BEFORE_RANGE_SECRET", "AFTER_RANGE_SECRET", "FOREIGN_CALENDAR_SECRET", totalOwner.passwordHash]) assert.ok(!html.includes(value));
    const otherHtml = await (await f.request(analyticsPath, other)).text(); assert.ok(otherHtml.includes("FOREIGN_CALENDAR_SECRET")); assert.ok(!otherHtml.includes("Начало диапазона"));
    assert.ok((await (await f.request("/plan/analytics?from=2026-10-08&to=2026-10-07", totalOwner)).text()).includes("Укажите корректный период"));
    assert.ok((await (await f.request("/plan/analytics?from=2026-12-01&to=2026-12-02", totalOwner)).text()).includes("Записей в выбранном периоде нет"));
    assert.ok((await (await f.request(durationPath, totalOwner)).text()).includes("/plan/analytics?from=2026-10-01&amp;to=2026-10-31"));
    const [disabledOwn, disabledReportOwner] = await Promise.all([own, totalOwner].map(actor => f.db.user.update({ where: { id: actor.id }, data: { calendarEnabled: false, sessionVersion: { increment: 1 } } })));
    await f.session(disabledOwn); await f.session(disabledReportOwner);
    assert.ok(!(await (await f.request(durationPath, disabledOwn)).text()).includes("Часы 90"));
    assert.ok(!(await (await f.request(analyticsPath, disabledReportOwner)).text()).includes("Начало диапазона"));
  });
  await f.verifyProtected();
});
