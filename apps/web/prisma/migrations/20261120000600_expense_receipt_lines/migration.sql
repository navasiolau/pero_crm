CREATE TABLE "ExpenseReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "paymentId" TEXT NOT NULL REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "clientMutationId" TEXT NOT NULL UNIQUE,
  "requestFingerprint" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "ExpenseReceipt_active_payment_key"
  ON "ExpenseReceipt"("paymentId") WHERE "cancelledAt" IS NULL;
CREATE INDEX "ExpenseReceipt_paymentId_idx" ON "ExpenseReceipt"("paymentId");

CREATE TABLE "ExpenseReceiptLine" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "receiptId" TEXT NOT NULL REFERENCES "ExpenseReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "position" INTEGER NOT NULL CHECK ("position" >= 0),
  "movementId" TEXT NOT NULL UNIQUE REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amount" DECIMAL(12,2) NOT NULL CHECK ("amount" > 0),
  "unitPrice" DECIMAL(27,12) NOT NULL CHECK ("unitPrice" > 0),
  UNIQUE ("receiptId", "position")
);
