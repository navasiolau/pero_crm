ALTER TABLE "LogisticsMutation" DROP CONSTRAINT "LogisticsMutation_operation_check";
ALTER TABLE "LogisticsMutation" ADD CONSTRAINT "LogisticsMutation_operation_check"
  CHECK ("operation" IN ('create', 'update', 'delete'));
