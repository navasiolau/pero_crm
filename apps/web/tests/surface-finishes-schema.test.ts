import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normalizeFinishAssignment } from "../src/lib/surface-finishes";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const sql = readFileSync("prisma/migrations/20260929190000_surface_finishes/migration.sql", "utf8");

test("finish schema adds same-revision item and protected sample file references", () => {
  assert.match(schema, /model ProductCompositionFinish \{/);
  assert.match(schema, /@@unique\(\[itemId, surfaceKind, normalizedSurfaceLabel, layerOrder\], map: "CompositionFinish_surface_layer_key"\)/);
  assert.match(sql, /CREATE UNIQUE INDEX "CompositionFinish_surface_layer_key"/);
  assert.match(sql, /FOREIGN KEY \("revisionId", "itemId"\) REFERENCES "ProductCompositionItem"\("revisionId", "id"\)/);
  assert.match(sql, /FOREIGN KEY \("sampleFileId"\) REFERENCES "File"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /CREATE TRIGGER "ProductCompositionFinish_guard" BEFORE INSERT OR UPDATE OR DELETE/);
  assert.match(sql, /FOR UPDATE[\s\S]*DRAFT[\s\S]*immutable/);
  assert.match(sql, /image\/jpeg[\s\S]*image\/png[\s\S]*image\/webp/);
  assert.doesNotMatch(sql, /(?:UPDATE|DELETE FROM|TRUNCATE) "(?:ProductCompositionItem|ProductCompositionRevision|File)"/);
});

test("NFKC uppercase key may expand beyond the 80-character visible label", () => {
  const normalized = normalizeFinishAssignment({ itemId: "item", surfaceKind: "FACE", surfaceLabel: "ß".repeat(80),
    layerOrder: 1, finishKind: "ENAMEL", name: "Эмаль", code: "CODE", colorHex: null, sampleFileId: null });
  assert.equal(Array.from(normalized.surfaceLabel).length, 80);
  assert.ok(Array.from(normalized.normalizedSurfaceLabel).length > 80);
  assert.ok(Array.from(normalized.normalizedSurfaceLabel).length <= 240);
  assert.match(sql, /length\(btrim\("normalizedSurfaceLabel"\)\) BETWEEN 1 AND 240/);
});

test("finish migration remains additive and pinned to LF", () => {
  assert.match(sql, /^--[\s\S]*BEGIN;[\s\S]*COMMIT;\s*$/);
  assert.equal(sql.includes("\r"), false);
  assert.match(readFileSync("../../.gitattributes", "utf8"), /20260929190000_surface_finishes\/migration\.sql text eol=lf/);
});
