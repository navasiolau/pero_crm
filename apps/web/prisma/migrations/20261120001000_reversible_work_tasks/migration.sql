ALTER TABLE "Task" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "deletedById" TEXT,
  ADD COLUMN "journalRevision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "journalFieldRevisions" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "Task" ADD COLUMN "journalDependencyRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Work" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "deletedById" TEXT,
  ADD COLUMN "journalRevision" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "journalFieldRevisions" JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX "Task_deletedAt_idx" ON "Task"("deletedAt");
CREATE INDEX "Work_deletedAt_idx" ON "Work"("deletedAt");

CREATE FUNCTION "increment_work_task_journal_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_values JSONB := to_jsonb(OLD) - ARRAY['journalRevision','journalFieldRevisions','updatedAt','splitRevision'];
  new_values JSONB := to_jsonb(NEW) - ARRAY['journalRevision','journalFieldRevisions','updatedAt','splitRevision'];
  field_name TEXT;
  field_revisions JSONB := OLD."journalFieldRevisions";
BEGIN
  NEW."journalRevision" := OLD."journalRevision";
  IF old_values IS DISTINCT FROM new_values THEN
    NEW."journalRevision" := OLD."journalRevision" + 1;
  END IF;
  FOR field_name IN SELECT jsonb_object_keys(new_values) LOOP
    IF old_values->field_name IS DISTINCT FROM new_values->field_name THEN
      field_revisions := jsonb_set(field_revisions, ARRAY[field_name], to_jsonb(NEW."journalRevision"));
    END IF;
  END LOOP;
  NEW."journalFieldRevisions" := field_revisions;
  RETURN NEW;
END $$;
CREATE TRIGGER "Task_journal_revision" BEFORE UPDATE ON "Task" FOR EACH ROW EXECUTE FUNCTION "increment_work_task_journal_revision"();
CREATE TRIGGER "Work_journal_revision" BEFORE UPDATE ON "Work" FOR EACH ROW EXECUTE FUNCTION "increment_work_task_journal_revision"();

CREATE FUNCTION "increment_task_dependency_journal_revision"() RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE "Task" SET "journalDependencyRevision" = "journalDependencyRevision" + 1 WHERE "id" IN (NEW."taskId", NEW."dependsOnId");
  ELSE
    UPDATE "Task" SET "journalDependencyRevision" = "journalDependencyRevision" + 1 WHERE "id" IN (OLD."taskId", OLD."dependsOnId");
  END IF;
  RETURN NULL;
END $;
CREATE TRIGGER "TaskDependency_journal_revision" AFTER INSERT OR DELETE ON "TaskDependency"
  FOR EACH ROW EXECUTE FUNCTION "increment_task_dependency_journal_revision"();
