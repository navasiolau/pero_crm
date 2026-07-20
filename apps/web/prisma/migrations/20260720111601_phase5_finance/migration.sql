-- Фаза 5 (§11): кассы, статьи расходов, мультивалютные платежи с курсом НБ РБ.
-- Существующие платежи — приходы в BYN: rate=1, эквиваленты = amount.

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('INCOME', 'EXPENSE');

-- CreateTable
CREATE TABLE "CashAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BYN',
    "comment" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseArticle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "comment" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseArticle_pkey" PRIMARY KEY ("id")
);

-- AlterTable: сначала nullable/с дефолтом, потом бэкфилл и NOT NULL
ALTER TABLE "Payment"
ADD COLUMN     "bynAmount" DECIMAL(12,2),
ADD COLUMN     "cashAccountId" TEXT,
ADD COLUMN     "direction" "PaymentDirection" NOT NULL DEFAULT 'INCOME',
ADD COLUMN     "expenseArticleId" TEXT,
ADD COLUMN     "projectAmount" DECIMAL(12,2),
ADD COLUMN     "rate" DECIMAL(14,6) NOT NULL DEFAULT 1,
ADD COLUMN     "rateDate" TIMESTAMP(3);

-- Бэкфилл: старые платежи — в BYN, курс 1
UPDATE "Payment" SET "bynAmount" = "amount", "projectAmount" = "amount";

ALTER TABLE "Payment"
ALTER COLUMN "bynAmount" SET NOT NULL,
ALTER COLUMN "projectAmount" SET NOT NULL;

-- Касса по умолчанию для существующих платежей (фиксированный id —
-- seed использует его же, так что дубля не будет)
INSERT INTO "CashAccount" ("id", "name", "currency", "comment", "active", "createdAt", "updatedAt")
VALUES ('seed-cash-main', 'Основная касса', 'BYN', 'Касса по умолчанию', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

UPDATE "Payment" SET "cashAccountId" = 'seed-cash-main' WHERE "cashAccountId" IS NULL;

-- CreateIndex
CREATE INDEX "Payment_cashAccountId_idx" ON "Payment"("cashAccountId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "CashAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_expenseArticleId_fkey" FOREIGN KEY ("expenseArticleId") REFERENCES "ExpenseArticle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
