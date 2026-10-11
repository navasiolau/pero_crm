BEGIN;

-- Дополнительные queue поля не меняют исходные события или завершённые доставки.
ALTER TABLE "DomainEvent"
  ADD COLUMN "queueAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "claimToken" TEXT,
  ADD COLUMN "leaseUntil" TIMESTAMPTZ(6),
  ADD COLUMN "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "exhaustedAt" TIMESTAMPTZ(6),
  ADD CONSTRAINT "DomainEvent_queueAttempts_nonnegative" CHECK ("queueAttempts" >= 0);

CREATE INDEX "DomainEvent_ready_queue_idx"
  ON "DomainEvent" ("processedAt", "exhaustedAt", "nextAttemptAt", "createdAt");

COMMIT;
