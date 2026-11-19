import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiToken } from "@prisma/client";
import { isWorkRatesOnly, WORK_RATES_SCOPE } from "../src/lib/estimate-rates";
import { createTokenVerifier } from "../src/server/plugins/token-verification";

test("estimate credential is exclusive, revoked immediately and rejected by general API consumers", async () => {
  const row = { id: "rates", name: "estimate", scopes: [WORK_RATES_SCOPE], pluginId: null, createdById: "owner", revokedAt: null } as ApiToken;
  let active = true;
  const verify = createTokenVerifier({ findToken: async () => row, isOwnerActive: async () => active, recordUse: async () => {} });
  const header = "Bearer pero_test";
  assert.ok(isWorkRatesOnly(row.scopes));
  assert.equal(await verify(header), null);
  assert.deepEqual((await verify(header, "work-rates"))?.scopes, [WORK_RATES_SCOPE]);
  assert.equal(isWorkRatesOnly(["admin"]), false);
  assert.equal(isWorkRatesOnly([WORK_RATES_SCOPE, "write"]), false);
  active = false;
  assert.equal(await verify(header, "work-rates"), null);
  active = true;
  row.revokedAt = new Date();
  assert.equal(await verify(header, "work-rates"), null);
});
