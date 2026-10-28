ALTER TABLE "LogisticsTrip" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "LogisticsTrip" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "LogisticsTrip" ADD CONSTRAINT "LogisticsTrip_deletion_pair"
  CHECK (("deletedAt" IS NULL) = ("deletedById" IS NULL));
CREATE INDEX "LogisticsTrip_deletedAt_date_id_idx" ON "LogisticsTrip"("deletedAt", "date", "id");
