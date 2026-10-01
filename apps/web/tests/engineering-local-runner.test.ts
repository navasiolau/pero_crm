import assert from "node:assert/strict";
import test from "node:test";
import { assertEngineeringLocalDatasource, assertEngineeringLocalSource, orderEngineeringSessionUsers, parseEngineeringLocalArgs, publicEngineeringSessionSummary } from "./engineering-local-runner.mjs";

const root = "D:\\Projects\\pero_crm_worktrees\\product-engineering-pay";
const cwd = `${root}\\apps\\web`;

test("runner import is inert; CLI accepts only named local QA operations", () => {
  assert.deepEqual(parseEngineeringLocalArgs(["dry"]), { operation: "dry", first: undefined, second: undefined });
  assert.equal(parseEngineeringLocalArgs(["plan", "manager", "client"]).operation, "plan");
  assert.equal(parseEngineeringLocalArgs(["capture", "C:\\private", "--partial"]).second, "--partial");
  for (const args of [["production"], ["dry", "extra"], ["plan", "manager"], ["prepare", "state", "--partial"],
    ["capture", "state", "--unknown"], ["cleanup", "state", "again"], ["sessions", "state", "extra"]])
    assert.throws(() => parseEngineeringLocalArgs(args), /USAGE_INVALID/);
});

test("source guard rejects another checkout and ambient database overrides", () => {
  assert.equal(assertEngineeringLocalSource({ platform: "win32", root, cwd, env: {} }), true);
  assert.equal(assertEngineeringLocalSource({ platform: "win32", root: root.replaceAll("\\", "/"), cwd: cwd.toLowerCase(), env: {} }), true);
  assert.throws(() => assertEngineeringLocalSource({ platform: "win32", root: "D:\\Projects\\pero_crm_v2", cwd, env: {} }), /SOURCE_NOT_APPROVED_WORKTREE/);
  assert.throws(() => assertEngineeringLocalSource({ platform: "win32", root, cwd, env: { DATABASE_URL: "postgresql://prod" } }), /AMBIENT_TARGET_OVERRIDE_FORBIDDEN/);
  assert.throws(() => assertEngineeringLocalSource({ platform: "linux", root, cwd, env: {} }), /SOURCE_NOT_APPROVED_WORKTREE/);
});

test("CLI session summary cannot expose an in-memory cookie", () => {
  const session = { status: "PASS", operation: "sessions", runId: "run", origin: "http://127.0.0.1:3106", count: 1,
    ttlSeconds: 900, plan: { public: true }, sessions: [{ userId: "user", cookie: { value: "PRIVATE_COOKIE" } }] };
  const summary = publicEngineeringSessionSummary(session);
  assert.equal(summary.tokens, "MEMORY_ONLY");
  assert.equal(JSON.stringify(summary).includes("PRIVATE_COOKIE"), false);
  assert.equal("sessions" in summary, false);
  assert.equal("plan" in summary, false);
});

test("exported DB wrapper rejects any non-local DSN before constructing Prisma", () => {
  const identity = { id: "bf45c761b5687e54bff1aafea82e8647925b5b425d6743ebdc7d33f4824b0ed5",
    name: "/pero_crm_pg", volume: { name: "pero_crm_v2_pgdata" } };
  const local = { identity, datasourceUrl: "postgresql://pero:secret@127.0.0.1:5433/pero_crm" };
  assert.equal(assertEngineeringLocalDatasource(local), local);
  for (const url of ["postgresql://pero:secret@127.0.0.1:5433/main", "postgresql://pero:secret@production:5432/pero_crm",
    "postgresql://pero:secret@127.0.0.1:5433/pero_crm?schema=other"])
    assert.throws(() => assertEngineeringLocalDatasource({ identity, datasourceUrl: url }), /LOCAL_DATASOURCE_FORBIDDEN/);
  assert.throws(() => assertEngineeringLocalDatasource({ ...local, identity: { ...identity, id: "other" } }), /LOCAL_DATASOURCE_FORBIDDEN/);
});

test("session roles follow explicit manager, E1, E2, worker order despite unordered DB rows", () => {
  const plan = { managerId: "manager", users: [{ id: "e1" }, { id: "e2" }, { id: "worker" }] };
  const dbRows = [{ id: "worker" }, { id: "e2" }, { id: "manager" }, { id: "e1" }];
  assert.deepEqual(orderEngineeringSessionUsers(dbRows, plan).map((row: { id: string }) => row.id), ["manager", "e1", "e2", "worker"]);
  assert.throws(() => orderEngineeringSessionUsers(dbRows.slice(1), plan), /SESSION_USERS_MISSING/);
});
