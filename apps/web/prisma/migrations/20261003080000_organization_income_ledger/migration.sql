ALTER TABLE "Payment" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "Payment" ALTER COLUMN "projectAmount" DROP NOT NULL;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_project_direction_check" CHECK (
  ("projectId" IS NOT NULL AND "projectAmount" IS NOT NULL) OR
  ("direction" = 'INCOME' AND "projectId" IS NULL AND "projectAmount" IS NULL)
);
