ALTER TABLE "ChangeLog"
  ADD COLUMN "operationRootId" TEXT,
  ADD COLUMN "reversal" JSONB,
  ADD COLUMN "reversesId" TEXT;

CREATE INDEX "ChangeLog_operationRootId_idx" ON "ChangeLog"("operationRootId");
CREATE UNIQUE INDEX "ChangeLog_reversesId_key" ON "ChangeLog"("reversesId");

ALTER TABLE "ChangeLog"
  ADD CONSTRAINT "ChangeLog_operationRootId_fkey" FOREIGN KEY ("operationRootId") REFERENCES "ChangeLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT "ChangeLog_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "ChangeLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ChangeLog_reversal_root" CHECK ("operationRootId" IS NULL OR ("operationRootId" <> "id" AND "reversal" IS NULL AND "reversesId" IS NULL)),
  ADD CONSTRAINT "ChangeLog_reversal_target" CHECK ("reversesId" IS NULL OR ("reversesId" <> "id" AND "reversal" IS NOT NULL));

ALTER TABLE "Product" ADD COLUMN "titleRevision" INTEGER NOT NULL DEFAULT 0;

CREATE FUNCTION "pero_increment_product_title_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."title" IS DISTINCT FROM OLD."title" THEN
    NEW."titleRevision" := OLD."titleRevision" + 1;
  ELSE
    NEW."titleRevision" := OLD."titleRevision";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Product_track_title_revision"
BEFORE UPDATE OF "title", "titleRevision" ON "Product"
FOR EACH ROW EXECUTE FUNCTION "pero_increment_product_title_revision"();
