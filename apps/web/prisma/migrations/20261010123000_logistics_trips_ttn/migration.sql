CREATE TYPE "LogisticsShipmentKind" AS ENUM ('PRODUCT', 'MATERIAL');
CREATE TYPE "LogisticsDocumentState" AS ENUM ('PENDING', 'READY');
CREATE TYPE "LogisticsDocumentStage" AS ENUM ('ISSUED', 'SIGNED');

CREATE TABLE "LogisticsTrip" (
  "id" TEXT PRIMARY KEY,
  "date" DATE NOT NULL,
  "comment" TEXT NOT NULL DEFAULT '',
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" >= 1),
  "createdById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "updatedById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "LogisticsTrip_date_id_idx" ON "LogisticsTrip"("date", "id");

CREATE TABLE "LogisticsProjectShare" (
  "id" TEXT PRIMARY KEY,
  "tripId" TEXT NOT NULL REFERENCES "LogisticsTrip"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "percentBps" INTEGER NOT NULL CHECK ("percentBps" > 0 AND "percentBps" <= 10000)
);
CREATE UNIQUE INDEX "LogisticsProjectShare_tripId_projectId_key" ON "LogisticsProjectShare"("tripId", "projectId");
CREATE INDEX "LogisticsProjectShare_projectId_tripId_idx" ON "LogisticsProjectShare"("projectId", "tripId");

CREATE TABLE "LogisticsShipmentLine" (
  "id" TEXT PRIMARY KEY,
  "tripId" TEXT NOT NULL REFERENCES "LogisticsTrip"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "projectId" TEXT NOT NULL,
  "kind" "LogisticsShipmentKind" NOT NULL,
  "productId" TEXT REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "materialId" TEXT REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "nameSnapshot" TEXT NOT NULL,
  "numberSnapshot" TEXT,
  "unitSnapshot" TEXT NOT NULL,
  "quantity" DECIMAL(12,3) NOT NULL CHECK ("quantity" > 0),
  CONSTRAINT "LogisticsShipmentLine_share_fkey" FOREIGN KEY ("tripId", "projectId")
    REFERENCES "LogisticsProjectShare"("tripId", "projectId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LogisticsShipmentLine_kind_ref" CHECK (
    ("kind" = 'PRODUCT' AND "productId" IS NOT NULL AND "materialId" IS NULL AND "quantity" = trunc("quantity")) OR
    ("kind" = 'MATERIAL' AND "materialId" IS NOT NULL AND "productId" IS NULL)
  )
);
CREATE UNIQUE INDEX "LogisticsShipmentLine_tripId_projectId_productId_key" ON "LogisticsShipmentLine"("tripId", "projectId", "productId");
CREATE UNIQUE INDEX "LogisticsShipmentLine_tripId_projectId_materialId_key" ON "LogisticsShipmentLine"("tripId", "projectId", "materialId");
CREATE INDEX "LogisticsShipmentLine_productId_idx" ON "LogisticsShipmentLine"("productId");
CREATE INDEX "LogisticsShipmentLine_materialId_idx" ON "LogisticsShipmentLine"("materialId");

CREATE TABLE "LogisticsDocument" (
  "id" TEXT PRIMARY KEY,
  "tripId" TEXT NOT NULL REFERENCES "LogisticsTrip"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "clientMutationId" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL CHECK ("size" > 0),
  "contentHash" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "storageMode" TEXT NOT NULL CHECK ("storageMode" IN ('local', 's3')),
  "state" "LogisticsDocumentState" NOT NULL DEFAULT 'PENDING',
  "stage" "LogisticsDocumentStage" NOT NULL,
  "ttnNumber" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readyAt" TIMESTAMP(3),
  CONSTRAINT "LogisticsDocument_ready_time" CHECK (("state" = 'READY') = ("readyAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "LogisticsDocument_clientMutationId_key" ON "LogisticsDocument"("clientMutationId");
CREATE UNIQUE INDEX "LogisticsDocument_storageKey_key" ON "LogisticsDocument"("storageKey");
CREATE INDEX "LogisticsDocument_tripId_state_createdAt_idx" ON "LogisticsDocument"("tripId", "state", "createdAt");
CREATE INDEX "LogisticsDocument_ttnNumber_idx" ON "LogisticsDocument"("ttnNumber");

CREATE TABLE "LogisticsMutation" (
  "clientMutationId" TEXT PRIMARY KEY,
  "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "tripId" TEXT NOT NULL REFERENCES "LogisticsTrip"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "operation" TEXT NOT NULL CHECK ("operation" IN ('create', 'update')),
  "requestFingerprint" TEXT NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" >= 1),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "LogisticsMutation_tripId_createdAt_idx" ON "LogisticsMutation"("tripId", "createdAt");

-- Сумма проверяется на конец транзакции, после атомарного изменения всех долей.
CREATE FUNCTION "check_logistics_share_total"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE trip_id TEXT; total INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'LogisticsTrip' THEN
    IF TG_OP = 'DELETE' THEN trip_id := OLD."id"; ELSE trip_id := NEW."id"; END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN trip_id := OLD."tripId"; ELSE trip_id := NEW."tripId"; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM "LogisticsTrip" WHERE "id" = trip_id) THEN
    SELECT COALESCE(sum("percentBps"), 0) INTO total FROM "LogisticsProjectShare" WHERE "tripId" = trip_id;
    IF total <> 10000 THEN RAISE EXCEPTION 'LOGISTICS_SHARES_MUST_TOTAL_10000' USING ERRCODE = '23514'; END IF;
  END IF;
  IF TG_TABLE_NAME = 'LogisticsProjectShare' THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD."tripId" <> NEW."tripId" AND EXISTS (SELECT 1 FROM "LogisticsTrip" WHERE "id" = OLD."tripId") THEN
        SELECT COALESCE(sum("percentBps"), 0) INTO total FROM "LogisticsProjectShare" WHERE "tripId" = OLD."tripId";
        IF total <> 10000 THEN RAISE EXCEPTION 'LOGISTICS_SHARES_MUST_TOTAL_10000' USING ERRCODE = '23514'; END IF;
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "LogisticsTrip_share_total"
  AFTER INSERT OR UPDATE ON "LogisticsTrip" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "check_logistics_share_total"();
CREATE CONSTRAINT TRIGGER "LogisticsProjectShare_total"
  AFTER INSERT OR UPDATE OR DELETE ON "LogisticsProjectShare" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "check_logistics_share_total"();
