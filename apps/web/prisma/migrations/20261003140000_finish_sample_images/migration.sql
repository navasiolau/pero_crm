CREATE TABLE "CatalogueMediaAsset" (
 "id" UUID NOT NULL, "finishId" UUID NOT NULL, "fileName" TEXT NOT NULL, "mimeType" TEXT NOT NULL,
 "size" INTEGER NOT NULL, "originalHash" TEXT NOT NULL, "storageKey" TEXT NOT NULL, "uploadedById" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "retiredAt" TIMESTAMP(3), "deletedAt" TIMESTAMP(3),
 CONSTRAINT "CatalogueMediaAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CatalogueMediaAsset_storageKey_key" ON "CatalogueMediaAsset"("storageKey");
CREATE UNIQUE INDEX "CatalogueMediaAsset_id_finishId_key" ON "CatalogueMediaAsset"("id", "finishId");
CREATE INDEX "CatalogueMediaAsset_finishId_retiredAt_idx" ON "CatalogueMediaAsset"("finishId", "retiredAt");
ALTER TABLE "Finish" ADD COLUMN "sampleAssetId" UUID;
ALTER TABLE "ProductFinishAssignment" ADD COLUMN "sampleAssetId" UUID;
ALTER TABLE "CatalogueMediaAsset" ADD CONSTRAINT "CatalogueMediaAsset_finishId_fkey" FOREIGN KEY ("finishId") REFERENCES "Finish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Finish" ADD CONSTRAINT "Finish_sampleAssetId_id_fkey" FOREIGN KEY ("sampleAssetId", "id") REFERENCES "CatalogueMediaAsset"("id", "finishId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "ProductFinishAssignment" ADD CONSTRAINT "ProductFinishAssignment_sampleAssetId_finishId_fkey" FOREIGN KEY ("sampleAssetId", "finishId") REFERENCES "CatalogueMediaAsset"("id", "finishId") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE INDEX "Finish_sampleAssetId_idx" ON "Finish"("sampleAssetId");
CREATE INDEX "ProductFinishAssignment_sampleAssetId_idx" ON "ProductFinishAssignment"("sampleAssetId");
