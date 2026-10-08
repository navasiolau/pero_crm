CREATE TYPE "StockReceiptKind" AS ENUM ('INVENTORY', 'PAID');
ALTER TABLE "StockMovement" ADD COLUMN "receiptKind" "StockReceiptKind";
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_receipt_kind_check"
  CHECK ("receiptKind" IS NULL OR "type" = 'INCOME');
