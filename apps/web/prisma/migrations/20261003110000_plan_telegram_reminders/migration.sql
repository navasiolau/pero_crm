CREATE TYPE "TelegramReminderState" AS ENUM ('READY','CLAIMED','SENDING','SENT','RETRY','FAILED','UNKNOWN','CANCELLED');
CREATE TABLE "TelegramReminderOutbox" (
 "id" TEXT NOT NULL, "namespace" TEXT NOT NULL, "factId" TEXT NOT NULL, "ownerId" TEXT NOT NULL,
 "entryId" TEXT NOT NULL, "entryRevision" INTEGER NOT NULL, "chatIdSnapshot" TEXT NOT NULL,
 "linkIdSnapshot" TEXT NOT NULL, "linkedAtSnapshot" TIMESTAMPTZ(3) NOT NULL,
 "state" "TelegramReminderState" NOT NULL DEFAULT 'READY', "attempts" INTEGER NOT NULL DEFAULT 0,
 "claimId" TEXT, "leaseExpiresAt" TIMESTAMPTZ(3), "retryAt" TIMESTAMPTZ(3), "retryAfterSeconds" INTEGER, "sentAt" TIMESTAMPTZ(3),
 "messageId" TEXT, "resultCode" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "TelegramReminderOutbox_pkey" PRIMARY KEY("id"),
 CONSTRAINT "TelegramReminderOutbox_factId_fkey" FOREIGN KEY("factId") REFERENCES "CalendarReminderFact"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "TelegramReminderOutbox_ownerId_fkey" FOREIGN KEY("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "TelegramReminderOutbox_entryId_fkey" FOREIGN KEY("entryId") REFERENCES "CalendarEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "TelegramReminderOutbox_attempts_check" CHECK("attempts" BETWEEN 0 AND 3 AND "entryRevision">=0),
 CONSTRAINT "TelegramReminderOutbox_chat_check" CHECK("chatIdSnapshot" ~ '^[1-9][0-9]{0,15}$'),
 CONSTRAINT "TelegramReminderOutbox_retry_check" CHECK("retryAfterSeconds" IS NULL OR "retryAfterSeconds" BETWEEN 1 AND 3600),
 CONSTRAINT "TelegramReminderOutbox_sent_check" CHECK("state" <> 'SENT' OR ("messageId" IS NOT NULL AND "sentAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "TelegramReminderOutbox_namespace_factId_key" ON "TelegramReminderOutbox"("namespace","factId");
CREATE UNIQUE INDEX "TelegramReminderOutbox_claimId_key" ON "TelegramReminderOutbox"("claimId");
CREATE INDEX "TelegramReminderOutbox_namespace_state_retryAt_idx" ON "TelegramReminderOutbox"("namespace","state","retryAt");
