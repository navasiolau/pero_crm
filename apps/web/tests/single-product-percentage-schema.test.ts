import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { productEditWhere, productVisibilityWhere, projectVisibilityWhere } from "../src/server/access/visibility";

const sql = readFileSync(new URL("../prisma/migrations/20261002120000_single_product_percentage_pay/migration.sql", import.meta.url), "utf8");

test("assigned mounter reads non-DESIGN product/project without a synthetic task or write grant", () => {
  const actor = { id: "m", roles: ["MOUNTER"] as const };
  const input = { ...actor, roles: [...actor.roles] };
  assert.match(JSON.stringify(productVisibilityWhere(input)), /"mounterId":"m"/);
  assert.match(JSON.stringify(projectVisibilityWhere(input)), /"mounterId":"m"/);
  assert.match(JSON.stringify(productVisibilityWhere(input)), /"not":"DESIGN"/);
  assert.deepEqual(productEditWhere(input), { id: { in: [] } });
  assert.doesNotMatch(JSON.stringify(productVisibilityWhere({ id: "m", roles: ["WORKER"] })), /mounterId/);
  assert.deepEqual(productVisibilityWhere({ id: "m", roles: ["MOUNTER", "MANAGER"] }), {});
});

test("forward migration preserves financial history and never backfills old quantities", () => {
  assert.match(sql, /"calculationVersion" INTEGER NOT NULL DEFAULT 1/);
  assert.match(sql, /"calculationVersion" = 1 AND "quantitySnapshot" IS NULL/);
  assert.doesNotMatch(sql, /\b(?:DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN|UPDATE "(?:PayrollEntry|ProductPercentageCompletion)")/);
  assert.match(sql, /HAVING COUNT\(DISTINCT pp\."userId"\) = 1/g);
  // Counting only eligible joined rows would incorrectly choose the active user
  // when another historical participant is inactive or has lost their role.
  assert.equal((sql.match(/SELECT COUNT\(DISTINCT all_pp\."userId"\) FROM "ProductPercentageParticipant" all_pp WHERE all_pp\."configId" = c\."id"\) = 1/g) ?? []).length, 2);
  assert.match(sql, /p\."engineerId" IS NULL/);
  assert.match(sql, /'MOUNTER' = ANY\(u\."roles"\)/);
  assert.equal((sql.match(/WHERE NOT EXISTS \(SELECT 1 FROM "ProductPercentageCompletion"/g) ?? []).length, 2);
  assert.match(sql, /pay\."projectId" = p\."projectId" AND pay\."scheme" = 'PERCENT_PROJECT'/);
  assert.doesNotMatch(sql, /INSERT INTO "PayrollEntry"|title.*(?:LIKE|ILIKE)/);
});

test("v2 constraints validate unit/quantity/BYN snapshots and freeze all new inputs", () => {
  assert.match(sql, /"quantitySnapshot" IS NOT NULL AND "quantitySnapshot" > 0/);
  assert.match(sql, /"totalSnapshot" = "priceSnapshot" \* "quantitySnapshot"/);
  assert.match(sql, /"productCurrency" = 'BYN'/);
  assert.match(sql, /"payrollCurrency" = 'BYN'/);
  assert.match(sql, /"ratePercentSnapshot" = 0 OR \("recipientId" IS NOT NULL/);
  assert.match(sql, /NEW\."calculationVersion",NEW\."quantitySnapshot",NEW\."totalSnapshot",NEW\."recipientId"/);
  assert.match(sql, /OLD\."calculationVersion",OLD\."quantitySnapshot",OLD\."totalSnapshot",OLD\."recipientId"/);
});
