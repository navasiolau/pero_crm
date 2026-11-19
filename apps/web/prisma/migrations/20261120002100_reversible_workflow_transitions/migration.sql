ALTER TABLE "Project" ADD COLUMN "workflowRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "workflowRevision" INTEGER NOT NULL DEFAULT 0;

CREATE FUNCTION "pero_track_workflow_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  key text;
  before_data jsonb := to_jsonb(OLD);
  after_data jsonb := to_jsonb(NEW);
BEGIN
  NEW."workflowRevision" := OLD."workflowRevision";
  FOREACH key IN ARRAY TG_ARGV LOOP
    IF before_data->key IS DISTINCT FROM after_data->key THEN
      NEW."workflowRevision" := OLD."workflowRevision" + 1;
      EXIT;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Project_track_workflow_revision"
BEFORE UPDATE OF stage, "stageChangedAt", "workflowRevision", "refusalReason", "refusalComment" ON "Project"
FOR EACH ROW EXECUTE FUNCTION "pero_track_workflow_revision"('stage', 'stageChangedAt', 'refusalReason', 'refusalComment');
CREATE TRIGGER "Product_track_workflow_revision"
BEFORE UPDATE OF status, "statusChangedAt", "workflowRevision", "engineerId", "assemblerId", "mounterId" ON "Product"
FOR EACH ROW EXECUTE FUNCTION "pero_track_workflow_revision"('status', 'statusChangedAt', 'engineerId', 'assemblerId', 'mounterId');
