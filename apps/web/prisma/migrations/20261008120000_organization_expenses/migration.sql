ALTER TABLE "Payment" DROP CONSTRAINT "Payment_project_direction_check";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_project_context_check" CHECK (
    ("projectId" IS NULL) = ("projectAmount" IS NULL)
);
