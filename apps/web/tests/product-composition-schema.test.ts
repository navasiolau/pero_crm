import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sql = readFileSync("prisma/migrations/20260929120000_product_composition/migration.sql", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");

test("DDL is additive and keeps one draft plus same-product and same-revision parent references", () => {
  assert.match(sql, /BEGIN;[\s\S]*COMMIT;\s*$/);
  assert.match(sql, /ProductCompositionRevision_one_draft[\s\S]*WHERE "status" = 'DRAFT'/);
  assert.match(sql, /FOREIGN KEY \("productId", "baseRevisionId"\) REFERENCES "ProductCompositionRevision"\("productId", "id"\)/);
  assert.match(sql, /FOREIGN KEY \("revisionId", "parentId"\) REFERENCES "ProductCompositionItem"\("revisionId", "id"\)/);
  assert.match(schema, /@@unique\(\[revisionId, normalizedDesignation\]\)/);
  assert.doesNotMatch(sql, /(?:UPDATE|DELETE FROM|TRUNCATE) "(?:Product|Work|Task|ProjectMaterial)"/);
});

test("confirmed rows reject INSERT, UPDATE and DELETE; draft deletion remains explicit", () => {
  assert.match(sql, /"status" = 'CONFIRMED' AND "revisionNo" IS NOT NULL AND "revisionNo" > 0/);
  assert.match(sql, /CREATE TRIGGER "ProductCompositionItem_guard" BEFORE INSERT OR UPDATE OR DELETE/);
  assert.match(sql, /SELECT "status" INTO revision_state[\s\S]*FOR UPDATE/);
  assert.match(sql, /revision_state IS DISTINCT FROM 'DRAFT'[\s\S]*confirmed composition items are immutable/);
  assert.match(sql, /CREATE TRIGGER "ProductCompositionRevision_guard" BEFORE INSERT OR UPDATE OR DELETE/);
  assert.match(sql, /OLD\."status" = 'CONFIRMED'[\s\S]*confirmed composition revision is immutable/);
  assert.match(sql, /"revisionId"\) REFERENCES "ProductCompositionRevision"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /"quantityPerParent" BETWEEN 1 AND 1000000/);
  assert.match(sql, /OLD\."kind" = 'MODULE' AND NEW\."kind" <> 'MODULE'[\s\S]*composition module still has children/);
});
