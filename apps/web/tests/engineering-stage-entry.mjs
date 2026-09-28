/** Bundled into the reviewed staging web container. No I/O on import. */
import { lstatSync, readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { baselineEngineeringOwned, captureEngineeringOwned, cleanupEngineeringOwned, engineeringPublicPlan,
  prepareEngineeringOwned, validateEngineeringPlan } from "./engineering-owned-fixtures.mjs";

const TARGET = Object.freeze({ kind: "EXISTING_STAGING", containerId: "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a",
  guest: "crm-staging", host: "db", port: 5432, database: "crm" });
const MIGRATION = "20260928220000_product_engineering_pay";
const ORIGIN = "https://staging-crm.peromebel.by";
function stop(ok, code) { if (!ok) throw new Error(code); }
export function assertEngineeringStageTarget(value) {
  stop(value && Object.keys(value).length === Object.keys(TARGET).length &&
    Object.entries(TARGET).every(([key, expected]) => value[key] === expected), "STAGING_TARGET_FORBIDDEN");
  return value;
}
function sourceGuard() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  stop(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "db" &&
    (!url.port || url.port === "5432") && url.pathname === "/crm" && decodeURIComponent(url.username) === "crm" &&
    url.password.length > 0 && !url.hash && (!url.search || url.search === "?schema=public") &&
    !process.env.DIRECT_URL && !process.env.NODE_OPTIONS && !process.env.NODE_PATH,
  "STAGING_DATABASE_BINDING_MISMATCH");
}
async function databaseGuard(db) {
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const rows = await tx.$queryRawUnsafe("SELECT current_database() AS database,current_user AS username");
    stop(rows.length === 1 && rows[0].database === "crm" && rows[0].username === "crm", "STAGING_DATABASE_IDENTITY_MISMATCH");
    const migrations = await tx.$queryRawUnsafe('SELECT migration_name,finished_at,rolled_back_at FROM "_prisma_migrations"');
    stop(migrations.every((row) => row.finished_at !== null || row.rolled_back_at !== null) &&
      migrations.some((row) => row.migration_name === MIGRATION && row.finished_at !== null && row.rolled_back_at === null),
    "ENGINEERING_MIGRATION_NOT_APPLIED");
  }, { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 30000 });
}
function planData({ runId, managerId, clientId, users, baseline }) {
  const now = Date.now();
  const taskIds = [randomUUID(), randomUUID()];
  const number = `QA-ENG-${runId}`;
  return { format: "pero-engineering-owned-qa/v1", runId, target: TARGET, managerId, users, baseline,
    project: { id: randomUUID(), number, numberInt: -2000000000, title: `QA ${runId} engineering`, clientId, currency: "BYN" },
    product: { id: randomUUID(), number: `${number}-1`, title: `QA ${runId} product`, engineerId: users[0].id,
      expectedPrice: "10000.00", status: "DESIGN" },
    pool: { id: randomUUID() }, legacyWork: { id: randomUUID(), title: `QA ${runId} legacy`, quantity: "5.00", priceSnapshot: "100.00", total: "500.00" },
    legacyTasks: [{ id: taskIds[0], title: `QA ${runId} legacy A`, quantity: "2.00", assigneeId: users[0].id, status: "DONE",
      dueAt: new Date(now + 7 * 86400000).toISOString(), estimateMinutes: 60, doneAt: new Date(now).toISOString() },
    { id: taskIds[1], title: `QA ${runId} legacy B`, quantity: "3.00", assigneeId: users[0].id, status: "NEW",
      dueAt: new Date(now + 7 * 86400000).toISOString(), estimateMinutes: 60 }],
    historicalTimeEntry: { id: randomUUID(), taskId: taskIds[0], userId: users[0].id,
      startedAt: new Date(now - 3600000).toISOString(), stoppedAt: new Date(now).toISOString(), minutes: 60 },
    newWorkTitle: `QA ${runId} new engineering`, newWorkQuantity: "10.30" };
}
async function plan(db, request) {
  const { managerId, clientId } = request;
  stop(typeof managerId === "string" && managerId.length > 0 && typeof clientId === "string" && clientId.length > 0,
    "MANAGER_AND_CLIENT_IDS_REQUIRED");
  const [manager, client, baseline] = await Promise.all([
    db.user.findUnique({ where: { id: managerId }, select: { id: true, active: true, roles: true } }),
    db.client.findUnique({ where: { id: clientId }, select: { id: true } }),
    baselineEngineeringOwned(db, TARGET),
  ]);
  stop(manager?.active === true && manager.roles.includes("MANAGER") && client?.id === clientId, "REFERENCES_NOT_APPROVED");
  const runId = randomUUID();
  const { hash } = await import("@node-rs/argon2");
  const users = [];
  for (const [index, role] of ["ENGINEER", "ENGINEER", "WORKER"].entries()) {
    const password = randomBytes(64);
    let passwordHash;
    try { passwordHash = await hash(password); } finally { password.fill(0); }
    users.push({ id: randomUUID(), email: `qa-eng-${runId}-${index}@qa.invalid`, name: `QA ${runId} ${role} ${index}`,
      roles: [role], payScheme: "PIECE", active: true, passwordHash });
  }
  const value = planData({ runId, managerId, clientId, users, baseline });
  validateEngineeringPlan(value);
  return value;
}
async function sessions(db, request) {
  const value = request.plan;
  validateEngineeringPlan(value);
  stop(value.target.kind === "EXISTING_STAGING", "TARGET_FORBIDDEN");
  const ids = [value.managerId, ...value.users.map((user) => user.id)];
  const rows = await db.user.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, roles: true, sessionVersion: true } });
  const byId = new Map(rows.map((row) => [row.id, row]));
  stop(rows.length === 4 && byId.size === 4 && ids.every((id) => byId.has(id)), "SESSION_USERS_MISSING");
  const secret = process.env.AUTH_SECRET;
  stop(typeof secret === "string" && secret.length >= 32, "RUNTIME_AUTH_SECRET_REQUIRED");
  const { encode } = await import("@auth/core/jwt");
  const profiles = ["manager", "e1", "e2", "worker"];
  const output = [];
  for (const [index, id] of ids.entries()) {
    const user = byId.get(id);
    stop(index === 0 ? user.roles.includes("MANAGER") : JSON.stringify(user.roles) === JSON.stringify(value.users[index - 1].roles),
      "SESSION_ROLE_DRIFT");
    const cookies = [];
    for (const name of ["__Secure-authjs.session-token", "authjs.session-token"]) {
      cookies.push({ name, value: await encode({ token: { id, roles: user.roles, sessionVersion: user.sessionVersion },
        secret, salt: name, maxAge: 900 }), domain: "staging-crm.peromebel.by", path: "/", httpOnly: true, secure: true, sameSite: "Lax" });
    }
    output.push({ role: profiles[index], userId: id, cookie: cookies[0], companionCookie: cookies[1] });
  }
  const file = "/app/apps/web/.next/server/server-reference-manifest.json";
  const info = lstatSync(file);
  stop(info.isFile() && !info.isSymbolicLink() && info.size < 512 * 1024, "SERVER_REFERENCE_MANIFEST_MISSING");
  const deployed = JSON.parse(readFileSync(file, "utf8"));
  stop(deployed?.node && typeof deployed.node === "object", "SERVER_REFERENCE_MANIFEST_INVALID");
  const serverReferenceManifest = { node: Object.fromEntries(Object.entries(deployed.node).map(([id, item]) => {
    stop(typeof item?.exportedName === "string" && typeof item?.filename === "string", "SERVER_REFERENCE_MANIFEST_INVALID");
    return [id, { exportedName: item.exportedName, filename: item.filename }];
  })) };
  return { origin: ORIGIN, ttlSeconds: 900, plan: engineeringPublicPlan(value), sessions: output, serverReferenceManifest };
}

export async function executeEngineeringStage(request) {
  sourceGuard();
  stop(request?.target === "staging" && ["refs", "plan", "prepare", "capture", "cleanup", "sessions"].includes(request.operation),
    "REQUEST_INVALID");
  if (["prepare", "sessions"].includes(request.operation)) assertEngineeringStageTarget(request.plan?.target);
  if (["capture", "cleanup"].includes(request.operation)) assertEngineeringStageTarget(request.manifest?.target);
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ log: [] });
  try {
    await databaseGuard(db);
    let result;
    if (request.operation === "refs") {
      const [managers, client] = await Promise.all([
        db.user.findMany({ where: { active: true, roles: { has: "MANAGER" } }, select: { id: true, name: true, roles: true }, take: 8 }),
        db.client.findFirst({ select: { id: true, name: true, lastName: true, middleName: true }, orderBy: { id: "asc" } }),
      ]);
      result = { managers, firstClient: client && { id: client.id, displayName: [client.lastName, client.name, client.middleName].filter(Boolean).join(" ") } };
    } else if (request.operation === "plan") result = await plan(db, request);
    else if (request.operation === "prepare") result = await prepareEngineeringOwned({ db, plan: request.plan,
      durablePlanSha256: request.durablePlanSha256 });
    else if (request.operation === "capture") result = await captureEngineeringOwned({ db, target: TARGET, manifest: request.manifest,
      expectFinal: request.expectFinal === true });
    else if (request.operation === "cleanup") result = await cleanupEngineeringOwned({ db, target: TARGET,
      manifest: request.manifest, captured: request.captured, actionsDrained: request.actionsDrained === true });
    else result = await sessions(db, request);
    return { publicSummary: { status: "PASS", operation: request.operation, runId: result?.runId ?? request.plan?.runId ?? request.manifest?.runId ?? null,
      phase: result?.phase ?? null }, privatePayload: result };
  } finally { await db.$disconnect(); }
}

if (process.env.CRM_ENGINEERING_QA_INPUT) {
  void (async () => {
    let output;
    try {
      const raw = process.env.CRM_ENGINEERING_QA_INPUT;
      stop(raw.length <= 98304 && /^[A-Za-z0-9+/]*={0,2}$/.test(raw), "INPUT_INVALID");
      delete process.env.CRM_ENGINEERING_QA_INPUT;
      output = await executeEngineeringStage(JSON.parse(Buffer.from(raw, "base64").toString("utf8")));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      output = { publicSummary: { status: "STOP", code: /^[A-Z][A-Z0-9_]{3,100}$/.test(message) ? message : "QA_ENTRY_FAILED_INSPECT_OUTCOME" }, privatePayload: null };
    }
    process.stdout.write(JSON.stringify(output));
    process.exitCode = output.publicSummary.status === "PASS" ? 0 : 1;
  })();
}
