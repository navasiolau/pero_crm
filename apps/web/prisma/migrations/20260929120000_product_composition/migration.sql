-- Additive manual product composition. Prepared only; do not apply without target review.
BEGIN;

CREATE TYPE "CompositionRevisionStatus" AS ENUM ('DRAFT', 'CONFIRMED');
CREATE TYPE "CompositionItemKind" AS ENUM ('MODULE', 'PART', 'HARDWARE');

CREATE TABLE "ProductCompositionRevision" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "status" "CompositionRevisionStatus" NOT NULL DEFAULT 'DRAFT',
  "revisionNo" INTEGER,
  "baseRevisionId" TEXT,
  "draftVersion" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "confirmedById" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "requestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductCompositionRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductCompositionRevision_state_fields" CHECK (
    ("status" = 'DRAFT' AND "revisionNo" IS NULL AND "confirmedById" IS NULL AND "confirmedAt" IS NULL AND "requestId" IS NULL)
    OR ("status" = 'CONFIRMED' AND "revisionNo" IS NOT NULL AND "revisionNo" > 0 AND "confirmedById" IS NOT NULL
      AND "confirmedAt" IS NOT NULL AND "requestId" IS NOT NULL)
  ),
  CONSTRAINT "ProductCompositionRevision_version_nonnegative" CHECK ("draftVersion" >= 0)
);
CREATE UNIQUE INDEX "ProductCompositionRevision_productId_revisionNo_key" ON "ProductCompositionRevision"("productId", "revisionNo");
CREATE UNIQUE INDEX "ProductCompositionRevision_productId_id_key" ON "ProductCompositionRevision"("productId", "id");
CREATE UNIQUE INDEX "ProductCompositionRevision_requestId_key" ON "ProductCompositionRevision"("requestId");
CREATE UNIQUE INDEX "ProductCompositionRevision_one_draft" ON "ProductCompositionRevision"("productId") WHERE "status" = 'DRAFT';
CREATE INDEX "ProductCompositionRevision_productId_status_idx" ON "ProductCompositionRevision"("productId", "status");

CREATE TABLE "ProductCompositionItem" (
  "id" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "lineageId" TEXT NOT NULL,
  "parentId" TEXT,
  "kind" "CompositionItemKind" NOT NULL,
  "designation" TEXT NOT NULL,
  "normalizedDesignation" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "quantityPerParent" INTEGER NOT NULL,
  "travelsToInstallation" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductCompositionItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductCompositionItem_quantity_range" CHECK ("quantityPerParent" BETWEEN 1 AND 1000000),
  CONSTRAINT "ProductCompositionItem_text_required" CHECK (length(btrim("designation")) > 0 AND
    length(btrim("normalizedDesignation")) > 0 AND length(btrim("title")) > 0),
  CONSTRAINT "ProductCompositionItem_not_self_parent" CHECK ("parentId" IS NULL OR "parentId" <> "id")
);
CREATE UNIQUE INDEX "ProductCompositionItem_revisionId_id_key" ON "ProductCompositionItem"("revisionId", "id");
CREATE UNIQUE INDEX "ProductCompositionItem_revisionId_lineageId_key" ON "ProductCompositionItem"("revisionId", "lineageId");
CREATE UNIQUE INDEX "ProductCompositionItem_revisionId_normalizedDesignation_key" ON "ProductCompositionItem"("revisionId", "normalizedDesignation");
CREATE INDEX "ProductCompositionItem_revisionId_parentId_sortOrder_idx" ON "ProductCompositionItem"("revisionId", "parentId", "sortOrder");

ALTER TABLE "ProductCompositionRevision" ADD CONSTRAINT "ProductCompositionRevision_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductCompositionRevision" ADD CONSTRAINT "ProductCompositionRevision_baseRevision_same_product_fkey"
  FOREIGN KEY ("productId", "baseRevisionId") REFERENCES "ProductCompositionRevision"("productId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductCompositionItem" ADD CONSTRAINT "ProductCompositionItem_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "ProductCompositionRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductCompositionItem" ADD CONSTRAINT "ProductCompositionItem_parent_same_revision_fkey"
  FOREIGN KEY ("revisionId", "parentId") REFERENCES "ProductCompositionItem"("revisionId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "guard_product_composition_revision"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN RAISE EXCEPTION 'composition revision must start as draft'; END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" = 'CONFIRMED' THEN RAISE EXCEPTION 'confirmed composition revision is immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW."id" <> OLD."id" OR NEW."productId" <> OLD."productId" OR
     NEW."baseRevisionId" IS DISTINCT FROM OLD."baseRevisionId" OR
     NEW."createdById" <> OLD."createdById" OR NEW."createdAt" <> OLD."createdAt" OR
     NEW."draftVersion" < OLD."draftVersion" THEN
    RAISE EXCEPTION 'composition revision identity or version changed';
  END IF;
  IF NEW."status" = 'CONFIRMED' AND NOT EXISTS (
    SELECT 1 FROM "ProductCompositionItem" WHERE "revisionId" = OLD."id"
  ) THEN RAISE EXCEPTION 'empty composition cannot be confirmed'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ProductCompositionRevision_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProductCompositionRevision"
  FOR EACH ROW EXECUTE FUNCTION "guard_product_composition_revision"();

CREATE FUNCTION "guard_product_composition_item"() RETURNS trigger AS $$
DECLARE
  revision_state "CompositionRevisionStatus";
  parent_kind "CompositionItemKind";
  item_id TEXT;
  item_revision TEXT;
  item_parent TEXT;
BEGIN
  item_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END;
  item_revision := CASE WHEN TG_OP = 'DELETE' THEN OLD."revisionId" ELSE NEW."revisionId" END;
  item_parent := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW."parentId" END;
  SELECT "status" INTO revision_state FROM "ProductCompositionRevision" WHERE "id" = item_revision FOR UPDATE;
  IF revision_state IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'confirmed composition items are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."id" <> OLD."id" OR NEW."revisionId" <> OLD."revisionId" OR
    NEW."lineageId" <> OLD."lineageId") THEN RAISE EXCEPTION 'composition item identity changed'; END IF;
  IF TG_OP = 'UPDATE' AND OLD."kind" = 'MODULE' AND NEW."kind" <> 'MODULE' AND EXISTS (
    SELECT 1 FROM "ProductCompositionItem" WHERE "revisionId" = OLD."revisionId" AND "parentId" = OLD."id"
  ) THEN RAISE EXCEPTION 'composition module still has children'; END IF;
  IF item_parent IS NOT NULL THEN
    SELECT "kind" INTO parent_kind FROM "ProductCompositionItem"
      WHERE "revisionId" = item_revision AND "id" = item_parent;
    IF parent_kind IS DISTINCT FROM 'MODULE' THEN RAISE EXCEPTION 'composition parent must be a module'; END IF;
    IF EXISTS (
      WITH RECURSIVE ancestors("id", "parentId", depth) AS (
        SELECT "id", "parentId", 1 FROM "ProductCompositionItem"
          WHERE "revisionId" = item_revision AND "id" = item_parent
        UNION ALL
        SELECT p."id", p."parentId", a.depth + 1 FROM "ProductCompositionItem" p
          JOIN ancestors a ON p."id" = a."parentId" AND p."revisionId" = item_revision
          WHERE a.depth <= 16
      ) SELECT 1 FROM ancestors WHERE "id" = item_id OR depth >= 16
    ) THEN RAISE EXCEPTION 'composition cycle or depth exceeded'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ProductCompositionItem_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProductCompositionItem"
  FOR EACH ROW EXECUTE FUNCTION "guard_product_composition_item"();

COMMIT;
