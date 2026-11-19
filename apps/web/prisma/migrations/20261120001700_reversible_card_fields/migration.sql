ALTER TABLE "Product" ADD COLUMN "fieldRevisions" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "Project" ADD COLUMN "fieldRevisions" JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE FUNCTION "pero_track_card_fields"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  key text;
  names text[];
  legacy jsonb := to_jsonb(OLD);
  updated jsonb := to_jsonb(NEW);
  revisions jsonb := OLD."fieldRevisions";
BEGIN
  FOREACH key IN ARRAY TG_ARGV LOOP
    names := string_to_array(key, ',');
    IF EXISTS (SELECT 1 FROM unnest(names) AS column_name WHERE legacy -> column_name IS DISTINCT FROM updated -> column_name) THEN
      revisions := jsonb_set(revisions, ARRAY[key], to_jsonb(COALESCE((revisions ->> key)::bigint, 0) + 1));
    END IF;
  END LOOP;
  NEW."fieldRevisions" := revisions;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Product_track_card_fields"
BEFORE UPDATE OF "fieldRevisions", "description", "kind", "engineerId", "quantity", "expectedPrice", "technicalSpecifications" ON "Product"
FOR EACH ROW EXECUTE FUNCTION "pero_track_card_fields"('description', 'kind', 'engineerId', 'quantity', 'expectedPrice', 'technicalSpecifications,description');

CREATE TRIGGER "Project_track_card_fields"
BEFORE UPDATE OF "fieldRevisions", "title", "managerId", "address", "clientId", "contactPerson", "servicesTotal", "delivery", "unloading", "installation" ON "Project"
FOR EACH ROW EXECUTE FUNCTION "pero_track_card_fields"('title', 'managerId', 'address', 'clientId,contactPerson', 'servicesTotal,delivery,unloading,installation');
