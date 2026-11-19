ALTER TABLE "Payment"
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedById" TEXT,
  ADD COLUMN "lastActionId" TEXT,
  ADD CONSTRAINT "Payment_deleted_actor_check" CHECK (("deletedAt" IS NULL) = ("deletedById" IS NULL));
