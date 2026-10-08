ALTER TABLE "CalendarEntry" ADD COLUMN "plannedMinutes" INTEGER;
ALTER TABLE "CalendarEntry" ADD CONSTRAINT "CalendarEntry_plannedMinutes_nonnegative"
  CHECK ("plannedMinutes" IS NULL OR "plannedMinutes" >= 0);
