CREATE TYPE "CounterpartyType" AS ENUM ('SUPPLIER', 'CARRIER');

CREATE TABLE "Counterparty" (
  "id" TEXT NOT NULL,
  "type" "CounterpartyType" NOT NULL,
  "company" TEXT NOT NULL,
  "phone" TEXT,
  "comment" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Counterparty_pkey" PRIMARY KEY ("id")
);
