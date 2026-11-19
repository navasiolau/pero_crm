ALTER TABLE "TaskDependency" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE OR REPLACE FUNCTION "increment_task_dependency_journal_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "Task" SET "journalDependencyRevision" = "journalDependencyRevision" + 1 WHERE "id" IN (OLD."taskId", OLD."dependsOnId");
  ELSE
    UPDATE "Task" SET "journalDependencyRevision" = "journalDependencyRevision" + 1 WHERE "id" IN (NEW."taskId", NEW."dependsOnId");
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER "TaskDependency_visibility_journal_revision"
  AFTER UPDATE OF "deletedAt" ON "TaskDependency"
  FOR EACH ROW WHEN (OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt")
  EXECUTE FUNCTION "increment_task_dependency_journal_revision"();

-- Последний шаг выпущенной цепочки обновляет права и для новых колонок.
DO $grants$
BEGIN
  IF to_regprocedure('public.pero_refresh_runtime_grants()') IS NOT NULL THEN
    PERFORM public.pero_refresh_runtime_grants();
  END IF;
END
$grants$;
