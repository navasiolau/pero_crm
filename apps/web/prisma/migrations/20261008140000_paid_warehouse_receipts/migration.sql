CREATE TABLE "StockPurchase" (
  "id" TEXT NOT NULL,
  "clientMutationId" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "movementId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockPurchase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StockPurchase_positive_price_check" CHECK ("unitPrice" > 0),
  CONSTRAINT "StockPurchase_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "StockMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "StockPurchase_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StockPurchase_clientMutationId_key" ON "StockPurchase"("clientMutationId");
CREATE UNIQUE INDEX "StockPurchase_movementId_key" ON "StockPurchase"("movementId");
CREATE UNIQUE INDEX "StockPurchase_paymentId_key" ON "StockPurchase"("paymentId");
CREATE INDEX "StockPurchase_actorId_idx" ON "StockPurchase"("actorId");
