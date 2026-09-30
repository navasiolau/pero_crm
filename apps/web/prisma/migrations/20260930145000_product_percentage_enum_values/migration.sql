-- Enum values are committed in a separate migration before CHECK constraints
-- use them. Do not wrap both migrations in one explicit transaction.
ALTER TYPE "WorkPaymentKind" ADD VALUE 'INSTALLATION';
ALTER TYPE "TaskAllocationBudgetSource" ADD VALUE 'PHYSICAL_ONLY';
