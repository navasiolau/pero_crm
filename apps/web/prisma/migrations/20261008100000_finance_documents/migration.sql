CREATE TYPE "FinanceDocumentState" AS ENUM ('PENDING', 'READY');

CREATE TABLE "FinanceDocument" (
    "id" TEXT NOT NULL,
    "clientMutationId" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "storageMode" TEXT NOT NULL,
    "state" "FinanceDocumentState" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    CONSTRAINT "FinanceDocument_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinanceDocument_positive_size" CHECK ("size" > 0),
    CONSTRAINT "FinanceDocument_storage_mode" CHECK ("storageMode" IN ('local', 's3')),
    CONSTRAINT "FinanceDocument_ready_time" CHECK (("state" = 'READY') = ("readyAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "FinanceDocument_clientMutationId_key" ON "FinanceDocument"("clientMutationId");
CREATE UNIQUE INDEX "FinanceDocument_storageKey_key" ON "FinanceDocument"("storageKey");
CREATE INDEX "FinanceDocument_uploadedById_state_createdAt_idx" ON "FinanceDocument"("uploadedById", "state", "createdAt");
CREATE INDEX "FinanceDocument_state_createdAt_idx" ON "FinanceDocument"("state", "createdAt");
ALTER TABLE "FinanceDocument" ADD CONSTRAINT "FinanceDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD COLUMN "reportDocumentId" TEXT;
CREATE UNIQUE INDEX "Payment_reportDocumentId_key" ON "Payment"("reportDocumentId");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reportDocumentId_fkey" FOREIGN KEY ("reportDocumentId") REFERENCES "FinanceDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
