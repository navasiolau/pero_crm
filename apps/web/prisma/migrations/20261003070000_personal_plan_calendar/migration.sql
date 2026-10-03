CREATE TYPE "CalendarEntryState" AS ENUM ('PLANNED','COMPLETED','CANCELLED');
CREATE TABLE "CalendarEntry" (
 "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "title" VARCHAR(250) NOT NULL,
 "description" TEXT NOT NULL DEFAULT '', "startsAt" TIMESTAMPTZ(3) NOT NULL,
 "state" "CalendarEntryState" NOT NULL DEFAULT 'PLANNED', "reminderOffsetMinutes" INTEGER DEFAULT 15,
 "revision" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "CalendarEntry_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "CalendarEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "CalendarEntry_revision_check" CHECK ("revision" >= 0),
 CONSTRAINT "CalendarEntry_reminder_check" CHECK ("reminderOffsetMinutes" IS NULL OR "reminderOffsetMinutes" IN (0,15,60,1440))
);
CREATE INDEX "CalendarEntry_ownerId_startsAt_idx" ON "CalendarEntry"("ownerId","startsAt");
