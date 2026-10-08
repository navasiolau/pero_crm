CREATE TABLE "WarehouseMovementDeletion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clientMutationId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "rootMovementId" TEXT NOT NULL,
  "planFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WarehouseMovementDeletion_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WarehouseMovementDeletion_rootMovementId_fkey" FOREIGN KEY ("rootMovementId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WarehouseMovementDeletion_clientMutationId_key" ON "WarehouseMovementDeletion"("clientMutationId");
CREATE UNIQUE INDEX "WarehouseMovementDeletion_rootMovementId_key" ON "WarehouseMovementDeletion"("rootMovementId");
ALTER TABLE "StockMovement" ADD COLUMN "deletionId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "deletionId" TEXT;
ALTER TABLE "WarehouseMovementValuation" ADD COLUMN "accountingRevision" INTEGER;
ALTER TABLE "WarehouseMovementValuation" ADD CONSTRAINT "WarehouseMovementValuation_revision_check" CHECK ("accountingRevision" IS NULL OR "accountingRevision">0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_deletionId_fkey" FOREIGN KEY ("deletionId") REFERENCES "WarehouseMovementDeletion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_deletionId_fkey" FOREIGN KEY ("deletionId") REFERENCES "WarehouseMovementDeletion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "StockMovement_deletionId_idx" ON "StockMovement"("deletionId");
CREATE INDEX "Payment_deletionId_idx" ON "Payment"("deletionId");
