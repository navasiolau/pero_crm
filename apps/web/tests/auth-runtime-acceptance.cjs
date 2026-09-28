// Run via stdin in the isolated Linux app container, cwd=/app/apps/web.
// It refuses a non-test/unmarked DB or a non-loopback HTTP endpoint.
/* eslint-disable @typescript-eslint/no-require-imports -- standalone stdin runner uses Node CommonJS */
const assert = require("node:assert/strict");
const { randomBytes, randomInt, randomUUID, createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const { hash } = require("@node-rs/argon2");

const db = new PrismaClient();
const base = new URL(process.env.PERO_AUTH_TEST_URL || "http://127.0.0.1:3137");
const id = `auth-runtime-${randomUUID()}`;
const secondId = `${id}-second`;
const clientId = `${id}-client`;
const projectId = `${id}-project`;
const fileId = `${id}-file`;
const directory = path.join(process.cwd(), "uploads", projectId);
const email = `${id}@example.invalid`;
const password1 = randomBytes(24).toString("base64url");
const password2 = randomBytes(24).toString("base64url");
const checks = [];
let stage = "preflight";
let guarded = false;

const passwordHash = (value) => hash(value, { memory: 19456, timeCost: 2, parallelism: 1 });

async function request(route, cookie, options = {}) {
  return fetch(new URL(route, base), {
    redirect: "manual", signal: AbortSignal.timeout(15000), ...options,
    headers: { ...(cookie ? { cookie } : {}), ...options.headers },
  });
}

async function login(password, loginEmail = email, expectSuccess = true) {
  const jar = new Map();
  const remember = (response) => {
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(";")[0];
      const index = pair.indexOf("=");
      jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  };
  const cookies = () => [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
  const csrfResponse = await request("/api/auth/csrf");
  remember(csrfResponse);
  const { csrfToken } = await csrfResponse.json();
  assert.equal(typeof csrfToken, "string", "csrf endpoint");
  const response = await request("/api/auth/callback/credentials", cookies(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Auth-Return-Redirect": "1" },
    body: new URLSearchParams({ email: loginEmail, password, csrfToken, callbackUrl: base.href }),
  });
  remember(response);
  const cookie = cookies();
  const session = await (await request("/api/auth/session", cookie)).json();
  if (expectSuccess) assert.equal(session?.user?.email, loginEmail, "credentials login");
  else assert.equal(session, null, "rejected credentials must not issue a session");
  return cookie;
}

async function rejected(cookie, label) {
  const session = await (await request("/api/auth/session", cookie)).json();
  assert.equal(session, null, `${label}: session endpoint`);
  for (const route of ["/settings/users", "/api/search?q=auth-runtime", `/api/files/${fileId}`]) {
    const response = await request(route, cookie);
    assert.ok([302, 303, 307, 308, 401, 403].includes(response.status), `${label}: protected route ${route}`);
  }
  checks.push(label);
}

async function token(suffix) {
  const raw = `pero_${randomBytes(24).toString("base64url")}`;
  const tokenId = `${id}-token-${suffix}`;
  await db.apiToken.create({ data: {
    id: tokenId, name: "Isolated auth acceptance", prefix: raw.slice(0, 11),
    tokenHash: createHash("sha256").update(raw).digest("hex"), scopes: ["read"], createdById: id,
  } });
  return { raw, id: tokenId };
}

async function tokenStatus(value) {
  return (await request("/api/v1/plugins", null, { headers: { Authorization: `Bearer ${value.raw}` } })).status;
}

async function main() {
  const dsn = new URL(process.env.DATABASE_URL);
  const database = decodeURIComponent(dsn.pathname.slice(1));
  assert.match(database, /^pero_auth_test_[a-z0-9_]+$/);
  assert.equal(process.env.PERO_AUTH_TEST_CONFIRM, database);
  assert.ok(["127.0.0.1", "localhost"].includes(base.hostname));
  const [identity] = await db.$queryRaw`SELECT current_database() AS name, shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname=current_database()`;
  assert.equal(identity.name, database);
  assert.equal(identity.marker, "PERO_AUTH_TEST_DISPOSABLE");
  guarded = true;
  assert.ok(directory.startsWith(`${path.join(process.cwd(), "uploads")}${path.sep}`));

  stage = "fixtures";
  await db.user.create({ data: { id, email, name: "Isolated auth acceptance", passwordHash: await passwordHash(password1), roles: ["ADMIN"] } });
  await db.user.create({ data: { id: secondId, email: `${secondId}@example.invalid`, name: "Second auth acceptance", passwordHash: await passwordHash(password1), roles: ["ADMIN"] } });
  await db.client.create({ data: { id: clientId, name: "Isolated acceptance", phone: "000" } });
  const numberInt = 1500000000 + randomInt(100000000);
  await db.project.create({ data: { id: projectId, clientId, number: String(numberInt), numberInt, title: "Isolated auth acceptance" } });
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "fixture.txt"), "isolated-auth-content", { flag: "wx", mode: 0o600 });
  await db.file.create({ data: { id: fileId, projectId, fileName: "fixture.txt", storedName: "fixture.txt", mimeType: "text/plain", size: 21 } });

  stage = "initial-login-and-health";
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("cache-control"), "no-store");
  const healthBody = await health.json();
  assert.equal(healthBody.status, "ok");
  assert.equal(healthBody.database, "ok");
  assert.ok(Date.now() - Date.parse(healthBody.checkedAt) < 10000);
  const cookie1 = await login(password1);
  const secondCookie = await login(password1, `${secondId}@example.invalid`);
  assert.equal((await request("/settings/users", cookie1)).status, 200);
  const file = await request(`/api/files/${fileId}`, cookie1);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("cache-control"), "private, no-store");
  assert.equal(await file.text(), "isolated-auth-content");
  const key1 = await token("one");
  assert.equal(await tokenStatus(key1), 200);
  checks.push(stage);

  stage = "database-outage-health-and-auth-fail-closed";
  const adminDsn = new URL(process.env.DATABASE_URL);
  adminDsn.pathname = "/postgres";
  const admin = new PrismaClient({ datasourceUrl: adminDsn.href });
  try {
    // The name was strictly allowlisted and marker-checked above. Only this
    // disposable clone is fenced; the shared PG and other restored DBs stay up.
    await admin.$executeRawUnsafe(`ALTER DATABASE "${database}" WITH ALLOW_CONNECTIONS false`);
    await admin.$queryRaw`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=${database}`;
    assert.equal((await request("/api/health")).status, 503);
    assert.equal(await (await request("/api/auth/session", cookie1)).json(), null);
  } finally {
    await admin.$executeRawUnsafe(`ALTER DATABASE "${database}" WITH ALLOW_CONNECTIONS true`);
    await admin.$disconnect();
  }
  // A killed pooled connection can fail its first later use; allow the app to
  // discard it and reconnect. The fixture client's pool was killed as well.
  await db.$disconnect();
  let recovered = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    if ((await request("/api/health")).status === 200) { recovered = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert.equal(recovered, true, "database health recovery");
  assert.equal((await (await request("/api/auth/session", cookie1)).json()).user.id, id);
  checks.push(stage);

  stage = "password-revoke";
  await db.user.update({ where: { id }, data: { passwordHash: await passwordHash(password2) } });
  await rejected(cookie1, stage);
  assert.equal(await tokenStatus(key1), 200, "password-only reset preserves independent API credentials");
  await login(password1, email, false);
  const cookie2 = await login(password2);

  stage = "role-revoke-and-current-authority";
  await db.user.update({ where: { id }, data: { roles: ["WORKER"] } });
  await rejected(cookie2, stage);
  assert.equal(await tokenStatus(key1), 401);
  const workerCookie = await login(password2);
  for (const route of ["/settings/users", "/finance/payroll", "/changelog"]) {
    const response = await request(route, workerCookie);
    assert.ok([302, 303, 307, 308].includes(response.status), "worker admin/finance denied");
    assert.equal(new URL(response.headers.get("location"), base).pathname, "/");
  }
  assert.equal((await request(`/api/files/${fileId}`, workerCookie)).status, 404);
  await db.user.update({ where: { id }, data: { roles: ["ADMIN"] } });
  await rejected(workerCookie, "role-regrant-does-not-revive-worker-cookie");

  stage = "explicit-revoke";
  const cookie3 = await login(password2);
  await db.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
  await rejected(cookie3, stage);
  const cookie4 = await login(password2);
  const key2 = await token("two");

  stage = "deactivate-and-reactivate";
  await db.user.update({ where: { id }, data: { active: false } });
  await rejected(cookie4, stage);
  assert.equal(await tokenStatus(key2), 401);
  await login(password2, email, false);
  await db.user.update({ where: { id }, data: { active: true } });
  await rejected(cookie4, "reactivation-does-not-revive-cookie");
  assert.equal(await tokenStatus(key2), 401);
  const cookie5 = await login(password2);

  stage = "delete-user-and-null-token-owner";
  const key3 = await token("three");
  await db.user.delete({ where: { id } });
  await rejected(cookie5, stage);
  assert.equal(await tokenStatus(key3), 401);
  await db.apiToken.update({ where: { id: key3.id }, data: { createdById: null } });
  assert.equal(await tokenStatus(key3), 401);
  assert.equal((await (await request("/api/auth/session", secondCookie)).json()).user.id, secondId);
  checks.push("other-user-session-unaffected");
  console.log(JSON.stringify({ ok: true, database, checks }));
}

main().catch((error) => {
  // Deliberately exclude exception/cookies/passwords/DSNs from evidence output.
  console.error(JSON.stringify({ ok: false, failedStage: stage, errorName: error?.name, errorCode: error?.code, checks }));
  process.exitCode = 1;
}).finally(async () => {
  if (guarded) {
    try {
      await db.$disconnect();
      await db.apiToken.deleteMany({ where: { id: { startsWith: `${id}-token-` } } });
      await db.project.deleteMany({ where: { id: projectId } });
      await db.client.deleteMany({ where: { id: clientId } });
      await db.user.deleteMany({ where: { id: { in: [id, secondId] } } });
      await fs.unlink(path.join(directory, "fixture.txt")).catch(() => {});
      await fs.rmdir(directory).catch(() => {});
      console.log(JSON.stringify({ cleanup: "complete", fixturePrefix: id }));
    } catch {
      console.error(JSON.stringify({ cleanup: "failed", fixturePrefix: id }));
      process.exitCode = 1;
    }
  }
  await db.$disconnect();
});
