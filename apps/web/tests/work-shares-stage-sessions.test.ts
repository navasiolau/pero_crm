import assert from "node:assert/strict";
import test from "node:test";
import { selfTestStageSessionBridge } from "./work-shares-stage-sessions.mjs";

test("staging session bridge preserves verified claims and rejects wrong scope, salt and TTL without transport", async () => {
  const result = await selfTestStageSessionBridge();
  assert.deepEqual(result, { status: "PASS", checks: 23, scope: "SYNTHETIC_CRYPTO_ONLY", transport: "NOT_RUN" });
});
