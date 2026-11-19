ALTER TABLE "ProposalCurrentMedia" ADD COLUMN "detachedAt" TIMESTAMP(3);
ALTER TABLE "ProposalContractSource" ADD COLUMN "detachedAt" TIMESTAMP(3);

DROP INDEX "ProposalContractSource_contractId_position_key";
CREATE UNIQUE INDEX "ProposalContractSource_active_position_key"
ON "ProposalContractSource" ("contractId", position) WHERE "detachedAt" IS NULL;

-- Сохраняем прежний manifest и останавливаем удаление опубликованных материалов.
UPDATE "ProposalJob" AS j
SET state = 'CANCELLED',
    "leaseOwner" = NULL,
    "leaseUntil" = NULL,
    "lastErrorCode" = 'KP_RETENTION_HISTORY_PROTECTED',
    "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')
WHERE j.state IN ('PENDING', 'PROCESSING', 'FAILED')
  AND (j.kind = 'PRUNE_VERSIONS'
    OR (j.kind = 'PURGE_MEDIA' AND (
      j.payload->>'kind' IN ('ANNUAL_MEDIA', 'RETIRED_PRODUCT_COPY')
      OR (j.payload->>'kind' = 'UNATTACHED_MEDIA' AND EXISTS (
        SELECT 1 FROM "ProposalMedia" m
        LEFT JOIN "ProposalJob" u ON u.id = m."uploadJobId"
        WHERE m.id = j.payload->>'mediaId' AND m."proposalId" = j."proposalId"
          AND (m."uploadState" = 'READY' OR u.state = 'SUCCEEDED')
      ))
    )));

-- Прежний запрос мог успеть изменить байты до подтверждения. Повторное использование
-- копии разрешит только сверка по точному ключу и контрольной сумме.
UPDATE "ProposalJob" AS copy
SET result = COALESCE(copy.result, '{}'::jsonb) || '{"storageAvailability":"UNVERIFIED"}'::jsonb
FROM "ProposalJob" AS cleanup JOIN "File" AS f ON f.id = cleanup.payload->>'fileId'
WHERE cleanup.kind = 'PURGE_MEDIA' AND cleanup.payload->>'kind' = 'RETIRED_PRODUCT_COPY'
  AND cleanup."lastErrorCode" = 'KP_RETENTION_HISTORY_PROTECTED'
  AND cleanup.payload->>'projectId' = f."projectId" AND cleanup.payload->>'storedName' = f."storedName"
  AND copy.id = cleanup.payload->>'operationJobId' AND copy.id = f."proposalMediaCopyJobId"
  AND copy.kind = 'COPY_PRODUCT_MEDIA'
  AND jsonb_path_exists(cleanup.result, '$.objects.*.versions[*] ? (@.phase == "INTENT" || @.phase == "DELETED")');

ALTER TABLE "ProposalMedia" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "deletedById" TEXT;
