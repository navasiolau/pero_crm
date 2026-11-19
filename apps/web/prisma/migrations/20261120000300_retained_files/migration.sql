ALTER TABLE "File" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "deletedById" TEXT;

-- Сохраняем историю заданий, отменяем их выполнение и освобождаем захваты.
UPDATE "DomainEvent"
SET "processedAt" = (clock_timestamp() AT TIME ZONE 'UTC'),
    "claimToken" = NULL,
    "leaseUntil" = NULL,
    "exhaustedAt" = NULL,
    "lastError" = 'FILE_STORAGE_PURGE_CANCELLED'
WHERE "type" IN ('file.storage-delete', 'file.sketch-obsolete')
  AND "processedAt" IS NULL;

CREATE INDEX "File_retained_storage_binding_idx"
ON "File" (lower("projectId"), lower("storedName"))
WHERE "deletedAt" IS NOT NULL;
