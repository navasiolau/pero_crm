CREATE TABLE "ExpenseReceiptIssue" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "paymentId" TEXT NOT NULL REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "projectId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "clientMutationId" TEXT NOT NULL UNIQUE,
  "requestFingerprint" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ExpenseReceiptIssue_paymentId_idx" ON "ExpenseReceiptIssue"("paymentId");

CREATE TABLE "ExpenseReceiptIssueLine" (
  "issueId" TEXT NOT NULL REFERENCES "ExpenseReceiptIssue"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sourceMovementId" TEXT NOT NULL REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "movementId" TEXT NOT NULL UNIQUE REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY ("issueId", "sourceMovementId"),
  CHECK ("sourceMovementId" <> "movementId")
);
CREATE INDEX "ExpenseReceiptIssueLine_sourceMovementId_idx" ON "ExpenseReceiptIssueLine"("sourceMovementId");
