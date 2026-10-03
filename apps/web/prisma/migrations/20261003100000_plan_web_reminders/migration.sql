ALTER TABLE "CalendarEntry" ADD COLUMN "reminderNamespace" TEXT;
CREATE TYPE "CalendarReminderWebState" AS ENUM ('DELIVERED','SKIPPED');
CREATE TABLE "CalendarReminderFact" (
 "id" TEXT NOT NULL, "entryId" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "namespace" TEXT NOT NULL,
 "entryRevision" INTEGER NOT NULL, "scheduledFor" TIMESTAMPTZ(3) NOT NULL,
 "confirmedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "titleSnapshot" VARCHAR(250) NOT NULL, "startsAtSnapshot" TIMESTAMPTZ(3) NOT NULL,
 "webState" "CalendarReminderWebState" NOT NULL, "webNotificationId" TEXT,
 CONSTRAINT "CalendarReminderFact_pkey" PRIMARY KEY("id"),
 CONSTRAINT "CalendarReminderFact_entryId_fkey" FOREIGN KEY("entryId") REFERENCES "CalendarEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CalendarReminderFact_ownerId_fkey" FOREIGN KEY("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CalendarReminderFact_webNotificationId_fkey" FOREIGN KEY("webNotificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CalendarReminderFact_revision_check" CHECK("entryRevision">=0),
 CONSTRAINT "CalendarReminderFact_web_state_check" CHECK(("webState"='DELIVERED' AND "webNotificationId" IS NOT NULL) OR ("webState"='SKIPPED' AND "webNotificationId" IS NULL))
);
CREATE UNIQUE INDEX "CalendarReminderFact_namespace_entryId_entryRevision_key" ON "CalendarReminderFact"("namespace","entryId","entryRevision");
CREATE UNIQUE INDEX "CalendarReminderFact_webNotificationId_key" ON "CalendarReminderFact"("webNotificationId");
CREATE INDEX "CalendarReminderFact_namespace_confirmedAt_idx" ON "CalendarReminderFact"("namespace","confirmedAt");
CREATE INDEX "CalendarEntry_reminderNamespace_startsAt_idx" ON "CalendarEntry"("reminderNamespace","startsAt");
