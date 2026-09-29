import assert from "node:assert/strict";
import test from "node:test";
import { selfTestStageSessionBridge } from "./work-shares-stage-sessions.mjs";

test("staging session bridge preserves verified claims and rejects wrong scope, salt and TTL without transport", async (t) => {
  // Auth.js samples Date twice when issuing a JWT; this crypto/claims test must not depend on a second boundary.
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 8, 29, 12) });
  const result = await selfTestStageSessionBridge();
  assert.deepEqual(result, { status: "PASS", checks: 23, scope: "SYNTHETIC_CRYPTO_ONLY", transport: "NOT_RUN" });
});
