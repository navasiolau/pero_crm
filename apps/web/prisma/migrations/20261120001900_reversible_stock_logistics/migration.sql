ALTER TABLE "StockMovement" ADD COLUMN "warehouseLifecycleRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WarehouseMovementDeletion" ADD COLUMN "restorationSnapshot" JSONB, ADD COLUMN "restoredAt" TIMESTAMP(3);

DROP INDEX "WarehouseMovementDeletion_rootMovementId_key";
CREATE INDEX "WarehouseMovementDeletion_rootMovementId_idx" ON "WarehouseMovementDeletion"("rootMovementId");
CREATE UNIQUE INDEX "WarehouseMovementDeletion_active_root_key"
  ON "WarehouseMovementDeletion"("rootMovementId") WHERE "restoredAt" IS NULL;

CREATE FUNCTION "increment_stock_movement_lifecycle_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."warehouseLifecycleRevision" := OLD."warehouseLifecycleRevision";
  IF NEW."deletionId" IS DISTINCT FROM OLD."deletionId" THEN
    NEW."warehouseLifecycleRevision" := OLD."warehouseLifecycleRevision" + 1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "StockMovement_lifecycle_revision" BEFORE UPDATE OF "deletionId", "warehouseLifecycleRevision" ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION "increment_stock_movement_lifecycle_revision"();
