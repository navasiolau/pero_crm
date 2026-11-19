ALTER TABLE "MaterialCategory" ADD COLUMN "warehouseCatalogRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Material" ADD COLUMN "warehouseCatalogRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MaterialUnit" ADD COLUMN "warehouseCatalogRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "deletedById" TEXT;
ALTER TABLE "ProjectMaterial" ADD COLUMN "warehouseCatalogRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "deletedById" TEXT;

CREATE INDEX "MaterialUnit_deletedAt_idx" ON "MaterialUnit"("deletedAt");
CREATE INDEX "ProjectMaterial_deletedAt_idx" ON "ProjectMaterial"("deletedAt");

CREATE FUNCTION "increment_warehouse_catalog_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."warehouseCatalogRevision" := OLD."warehouseCatalogRevision";
  IF to_jsonb(NEW) - ARRAY['warehouseCatalogRevision','updatedAt']
    IS DISTINCT FROM to_jsonb(OLD) - ARRAY['warehouseCatalogRevision','updatedAt'] THEN
    NEW."warehouseCatalogRevision" := OLD."warehouseCatalogRevision" + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "MaterialCategory_catalog_revision" BEFORE UPDATE ON "MaterialCategory" FOR EACH ROW EXECUTE FUNCTION "increment_warehouse_catalog_revision"();
CREATE TRIGGER "Material_catalog_revision" BEFORE UPDATE ON "Material" FOR EACH ROW EXECUTE FUNCTION "increment_warehouse_catalog_revision"();
CREATE TRIGGER "MaterialUnit_catalog_revision" BEFORE UPDATE ON "MaterialUnit" FOR EACH ROW EXECUTE FUNCTION "increment_warehouse_catalog_revision"();
CREATE TRIGGER "ProjectMaterial_catalog_revision" BEFORE UPDATE ON "ProjectMaterial" FOR EACH ROW EXECUTE FUNCTION "increment_warehouse_catalog_revision"();

CREATE FUNCTION "check_warehouse_material_live_unit"() RETURNS trigger LANGUAGE plpgsql AS $
DECLARE archived_at TIMESTAMP(3);
BEGIN
  SELECT "deletedAt" INTO archived_at FROM "MaterialUnit" WHERE "id" = NEW."unitId" FOR SHARE;
  IF archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'WAREHOUSE_UNIT_ARCHIVED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $;
CREATE TRIGGER "Material_live_unit" BEFORE INSERT OR UPDATE OF "unitId" ON "Material"
  FOR EACH ROW EXECUTE FUNCTION "check_warehouse_material_live_unit"();
