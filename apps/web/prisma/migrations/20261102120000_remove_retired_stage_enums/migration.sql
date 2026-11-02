-- Архивные факты отделяются от рабочих enum; перенос не вызывает app status actions.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(18435, 55001);
LOCK TABLE "Project", "Product", "ProjectStageHistory", "ProductStatusHistory",
  "ProductPercentageCompletion", "CommercialProposal", "ProposalJob", "ChangeLog"
  IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE "ProjectStageHistory"
  ALTER COLUMN "fromStage" TYPE TEXT USING "fromStage"::text,
  ALTER COLUMN "toStage" TYPE TEXT USING "toStage"::text;
ALTER TABLE "ProductStatusHistory"
  ALTER COLUMN "fromStatus" TYPE TEXT USING "fromStatus"::text,
  ALTER COLUMN "toStatus" TYPE TEXT USING "toStatus"::text;
ALTER TABLE "ProductPercentageCompletion"
  ALTER COLUMN "statusAtCompletion" TYPE TEXT USING "statusAtCompletion"::text;

CREATE TEMP TABLE "_retired_projects_209" ON COMMIT DROP AS
SELECT p.id, p.stage::text AS "fromStage",
  CASE WHEN p.stage::text = 'RECLAMATION' THEN 'IN_WORK'
  ELSE COALESCE((
    SELECT v.stage
    FROM "ProjectStageHistory" h
    CROSS JOIN LATERAL (VALUES (h."toStage", 0), (h."fromStage", 1)) v(stage, priority)
    WHERE h."projectId" = p.id AND v.stage IN ('LEAD', 'ESTIMATE', 'CONTRACT', 'IN_WORK', 'DONE')
    ORDER BY h."createdAt" DESC, h.id DESC, v.priority ASC LIMIT 1
  ), 'IN_WORK') END AS "toStage"
FROM "Project" p WHERE p.stage::text IN ('PAUSED', 'RECLAMATION');

CREATE TEMP TABLE "_retired_products_209" ON COMMIT DROP AS
SELECT id, status::text AS "fromStatus" FROM "Product" WHERE status::text = 'RECLAMATION';

CREATE TEMP TABLE "_retired_proposals_209" ON COMMIT DROP AS
SELECT cp.id, cp."acceptedVersionId", cp."retentionEpoch"
FROM "CommercialProposal" cp JOIN "_retired_projects_209" p ON p.id = cp."projectId"
WHERE p."toStage" = 'LEAD';

UPDATE "ProposalJob" SET state = 'CANCELLED', "leaseOwner" = NULL, "leaseUntil" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
WHERE "proposalId" IN (SELECT id FROM "_retired_proposals_209")
  AND kind = 'PRUNE_VERSIONS' AND state IN ('PENDING', 'PROCESSING', 'FAILED');
UPDATE "CommercialProposal" cp SET "acceptedVersionId" = NULL, "acceptedAt" = NULL,
  "retentionEpoch" = old."retentionEpoch" + 1, "updatedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "_retired_proposals_209" old WHERE cp.id = old.id;
INSERT INTO "ChangeLog" (id, "actorType", "actorId", "actorName", entity, "entityId", action, field, "oldValue", "newValue", source, "createdAt")
SELECT 'migration209:acceptance:' || id, 'system', 'system', 'Миграция рабочих статусов №209',
  'commercialProposal', id, 'acceptance.retire', 'acceptedVersionId',
  jsonb_build_object('acceptedVersionId', "acceptedVersionId", 'retentionEpoch', "retentionEpoch"),
  jsonb_build_object('acceptedVersionId', NULL, 'retentionEpoch', "retentionEpoch" + 1, 'migration', '209'),
  'migration', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "_retired_proposals_209";

UPDATE "Project" p SET stage = old."toStage"::"ProjectStage", "stageChangedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "_retired_projects_209" old WHERE p.id = old.id;
INSERT INTO "ProjectStageHistory" (id, "projectId", "fromStage", "toStage", comment, "createdAt")
SELECT 'migration209:project:' || id, id, "fromStage", "toStage",
  'Служебный перенос статусов №209, без начислений и выпуска документов', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "_retired_projects_209";
INSERT INTO "ChangeLog" (id, "actorType", "actorId", "actorName", entity, "entityId", action, field, "oldValue", "newValue", source, "createdAt")
SELECT 'migration209:project:' || id, 'system', 'system', 'Миграция рабочих статусов №209',
  'project', id, 'stage.retire', 'stage', to_jsonb("fromStage"),
  jsonb_build_object('stage', "toStage", 'migration', '209'), 'migration', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "_retired_projects_209";

UPDATE "Product" p SET status = 'PRODUCTION', "statusChangedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "_retired_products_209" old WHERE p.id = old.id;
INSERT INTO "ProductStatusHistory" (id, "productId", "fromStatus", "toStatus", comment, "createdAt")
SELECT 'migration209:product:' || id, id, "fromStatus", 'PRODUCTION',
  'Служебный перенос статусов №209, без начислений и выпуска документов', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "_retired_products_209";
INSERT INTO "ChangeLog" (id, "actorType", "actorId", "actorName", entity, "entityId", action, field, "oldValue", "newValue", source, "createdAt")
SELECT 'migration209:product:' || id, 'system', 'system', 'Миграция рабочих статусов №209',
  'product', id, 'status.retire', 'status', to_jsonb("fromStatus"),
  jsonb_build_object('status', 'PRODUCTION', 'migration', '209'), 'migration', CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
FROM "_retired_products_209";

ALTER TABLE "Project" ALTER COLUMN stage DROP DEFAULT;
ALTER TYPE "ProjectStage" RENAME TO "ProjectStage_retired_209";
CREATE TYPE "ProjectStage" AS ENUM ('LEAD', 'ESTIMATE', 'CONTRACT', 'IN_WORK', 'DONE', 'REFUSED');
ALTER TABLE "Project" ALTER COLUMN stage TYPE "ProjectStage" USING stage::text::"ProjectStage";
ALTER TABLE "Project" ALTER COLUMN stage SET DEFAULT 'LEAD'::"ProjectStage";
DROP TYPE "ProjectStage_retired_209";

ALTER TABLE "Product" ALTER COLUMN status DROP DEFAULT;
ALTER TYPE "ProductStatus" RENAME TO "ProductStatus_retired_209";
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PREPARATION', 'DESIGN', 'PRODUCTION', 'STORAGE', 'INSTALLATION', 'DONE');
ALTER TABLE "Product" ALTER COLUMN status TYPE "ProductStatus" USING status::text::"ProductStatus";
ALTER TABLE "Product" ALTER COLUMN status SET DEFAULT 'DRAFT'::"ProductStatus";
DROP TYPE "ProductStatus_retired_209";
COMMIT;
