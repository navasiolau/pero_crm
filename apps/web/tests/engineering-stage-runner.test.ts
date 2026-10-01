import assert from "node:assert/strict";
import test from "node:test";
import { buildEngineeringStageBundle, validateEngineeringStageSeal } from "./engineering-stage-runner.mjs";
import { assertEngineeringStageTarget } from "./engineering-stage-entry.mjs";

const hash = "a".repeat(64);
const seal = { format: "pero-engineering-stage-seal/v1", sealedBy: "root", expectedRevision: "b".repeat(40),
  wrapperSha256: hash, bundleSha256: hash, runnerSha256: hash, entrySha256: hash, helperSha256: hash,
  supportSha256: "3876c60916df3c49a8f294847405eb5b41eaea8533e5165a0a850209ff73f790",
  backupReceiptSha256: hash, backupRunId: "12345678-1234-4123-8123-123456789abc" };

test("stage seal is exact and refuses an unpinned revision or source", () => {
  assert.equal(validateEngineeringStageSeal(seal), seal);
  assert.throws(() => validateEngineeringStageSeal({ ...seal, expectedRevision: "main" }), /ROOT_STAGE_SEAL_INVALID/);
  assert.throws(() => validateEngineeringStageSeal({ ...seal, helperSha256: "changed" }), /ROOT_STAGE_SEAL_INVALID/);
  assert.throws(() => validateEngineeringStageSeal({ ...seal, backupRunId: "unknown" }), /ROOT_STAGE_SEAL_INVALID/);
  assert.throws(() => validateEngineeringStageSeal({ ...seal, unexpected: true }), /ROOT_STAGE_SEAL_INVALID/);
});

test("reviewed staging bundle builds locally without connecting or running its entry", async () => {
  const bundle = await buildEngineeringStageBundle();
  assert.ok(bundle.length > 0 && bundle.length < 768 * 1024);
  assert.match(bundle.toString("utf8"), /CRM_ENGINEERING_QA_INPUT/);
  assert.equal(/import\(["']@auth\/core\/jwt["']\)/.test(bundle.toString("utf8")), false,
    "The standalone web image does not ship the JWT module as an external package");
});

test("staging entry rejects a local or extended target before a DB client exists", () => {
  const stage = { kind: "EXISTING_STAGING", containerId: "27b8f7342b9d722ab8788e137b37b03a3037442da038c5b8b98dbb30245b8b6a",
    guest: "crm-staging", host: "db", port: 5432, database: "crm" };
  assert.deepEqual(assertEngineeringStageTarget(stage), stage);
  assert.throws(() => assertEngineeringStageTarget({ ...stage, kind: "EXISTING_LOCAL" }), /STAGING_TARGET_FORBIDDEN/);
  assert.throws(() => assertEngineeringStageTarget({ ...stage, database: "pero_crm" }), /STAGING_TARGET_FORBIDDEN/);
  assert.throws(() => assertEngineeringStageTarget({ ...stage, production: true }), /STAGING_TARGET_FORBIDDEN/);
});
