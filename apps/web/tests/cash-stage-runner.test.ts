import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCashStageBundle, validateCashStageSeal } from "./cash-stage-runner.mjs";

test("stage seal pins reviewed backup receipt, support, source hashes and a precise deployment revision", () => {
  const seal = { format: "pero-cash-stage-seal/v1", sealedBy: "root",
    expectedRevision: "3f6da0da082cc707370346c9c3a458ba24d1c189",
    wrapperSha256: "a".repeat(64), bundleSha256: "b".repeat(64), entrySha256: "c".repeat(64),
    runnerSha256: "d".repeat(64), windowSha256: "e".repeat(64),
    supportSha256: "3876c60916df3c49a8f294847405eb5b41eaea8533e5165a0a850209ff73f790",
    backupReceiptSha256: "ec548ce7b64e3dc3a5e0a4958fdf6aca8073fa05673198390611048d3391814e",
    backupRunId: "667367d7-83e5-40f1-b06b-b57889170685" };
  assert.deepEqual(validateCashStageSeal(seal), seal);
  assert.throws(() => validateCashStageSeal({ ...seal, backupReceiptSha256: "0".repeat(64) }), /CASH_STAGE_SEAL_INVALID/);
  assert.throws(() => validateCashStageSeal({ ...seal, expectedRevision: "main" }), /CASH_STAGE_SEAL_INVALID/);
});

test("stage bundle remains one bounded inert Node module without live transport", async () => {
  const bundle = await buildCashStageBundle();
  assert.ok(bundle.length > 0 && bundle.length < 768 * 1024);
  assert.match(bundle.toString("utf8"), /CRM_CASH_QA_INPUT/);
  assert.doesNotMatch(bundle.toString("utf8"), /["']@auth\/core\/jwt["']/,
    "Auth.js JWT must be bundled because standalone does not expose that package");
});
