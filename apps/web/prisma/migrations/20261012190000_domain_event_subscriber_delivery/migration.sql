BEGIN;
CREATE TABLE "DomainEventDeliveryPlan" (
  "eventId" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DomainEventDeliveryPlan_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DomainEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "DomainEventDelivery" (
  "eventId" TEXT NOT NULL,
  "subscriberId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMPTZ(6),
  "skippedAt" TIMESTAMPTZ(6),
  "lastError" TEXT,
  "claimToken" TEXT,
  CONSTRAINT "DomainEventDelivery_pkey" PRIMARY KEY ("eventId", "subscriberId"),
  CONSTRAINT "DomainEventDelivery_nonnegative_check" CHECK ("attempts" >= 0 AND "position" >= 0),
  CONSTRAINT "DomainEventDelivery_terminal_check" CHECK ("deliveredAt" IS NULL OR "skippedAt" IS NULL),
  CONSTRAINT "DomainEventDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DomainEventDeliveryPlan"("eventId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DomainEventDelivery_eventId_position_key" ON "DomainEventDelivery"("eventId", "position");
COMMIT;