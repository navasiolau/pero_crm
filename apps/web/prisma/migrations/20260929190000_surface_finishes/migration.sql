-- Additive named surface finishes. Prepared only; do not apply without target review.
BEGIN;

CREATE TYPE "CompositionSurfaceKind" AS ENUM ('FACE', 'EDGE', 'WHOLE');
CREATE TYPE "CompositionFinishKind" AS ENUM ('ENAMEL', 'VENEER', 'COATING');

CREATE TABLE "ProductCompositionFinish" (
  "id" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "surfaceKind" "CompositionSurfaceKind" NOT NULL,
  "surfaceLabel" TEXT NOT NULL,
  "normalizedSurfaceLabel" TEXT NOT NULL,
  "layerOrder" INTEGER NOT NULL,
  "finishKind" "CompositionFinishKind" NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "colorHex" TEXT,
  "sampleFileId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductCompositionFinish_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductCompositionFinish_layerOrder_range" CHECK ("layerOrder" BETWEEN 1 AND 20),
  CONSTRAINT "ProductCompositionFinish_surface_text" CHECK (
    length(btrim("surfaceLabel")) BETWEEN 1 AND 80 AND
    length(btrim("normalizedSurfaceLabel")) BETWEEN 1 AND 240 AND
    ("surfaceKind" <> 'WHOLE' OR ("surfaceLabel" = 'Целиком' AND "normalizedSurfaceLabel" = 'ЦЕЛИКОМ'))
  ),
  CONSTRAINT "ProductCompositionFinish_finish_text" CHECK (
    length(btrim("name")) BETWEEN 1 AND 160 AND length(btrim("code")) BETWEEN 1 AND 160
  ),
  CONSTRAINT "ProductCompositionFinish_hex" CHECK ("colorHex" IS NULL OR "colorHex" ~ '^#[0-9A-F]{6}$')
);

CREATE UNIQUE INDEX "CompositionFinish_surface_layer_key"
  ON "ProductCompositionFinish"("itemId", "surfaceKind", "normalizedSurfaceLabel", "layerOrder");
CREATE INDEX "ProductCompositionFinish_revisionId_itemId_idx" ON "ProductCompositionFinish"("revisionId", "itemId");
CREATE INDEX "ProductCompositionFinish_sampleFileId_idx" ON "ProductCompositionFinish"("sampleFileId");

ALTER TABLE "ProductCompositionFinish" ADD CONSTRAINT "ProductCompositionFinish_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "ProductCompositionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductCompositionFinish" ADD CONSTRAINT "ProductCompositionFinish_item_same_revision_fkey"
  FOREIGN KEY ("revisionId", "itemId") REFERENCES "ProductCompositionItem"("revisionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductCompositionFinish" ADD CONSTRAINT "ProductCompositionFinish_sampleFileId_fkey"
  FOREIGN KEY ("sampleFileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "guard_product_composition_finish"() RETURNS trigger AS $$
DECLARE
  revision_state "CompositionRevisionStatus";
  revision_product TEXT;
  product_project TEXT;
  sample_product TEXT;
  sample_project TEXT;
  sample_mime TEXT;
BEGIN
  SELECT "status", "productId" INTO revision_state, revision_product
    FROM "ProductCompositionRevision"
    WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."revisionId" ELSE NEW."revisionId" END
    FOR UPDATE;
  IF revision_state IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'confirmed composition finishes are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND (
    NEW."id" <> OLD."id" OR NEW."revisionId" <> OLD."revisionId" OR NEW."itemId" <> OLD."itemId" OR
    NEW."createdAt" <> OLD."createdAt"
  ) THEN RAISE EXCEPTION 'composition finish identity is immutable'; END IF;
  IF NEW."sampleFileId" IS NOT NULL THEN
    SELECT "projectId" INTO product_project FROM "Product" WHERE "id" = revision_product;
    SELECT "productId", "projectId", "mimeType" INTO sample_product, sample_project, sample_mime
      FROM "File" WHERE "id" = NEW."sampleFileId" FOR KEY SHARE;
    IF sample_product IS DISTINCT FROM revision_product OR sample_project IS DISTINCT FROM product_project OR
      sample_mime IS NULL OR sample_mime NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN
      RAISE EXCEPTION 'composition finish sample must be an existing same-product raster file';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ProductCompositionFinish_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProductCompositionFinish"
  FOR EACH ROW EXECUTE FUNCTION "guard_product_composition_finish"();

COMMIT;
