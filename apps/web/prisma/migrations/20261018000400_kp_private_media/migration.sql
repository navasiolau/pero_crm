-- №183: только аддитивные метаданные. Объекты S3 и существующие File не изменяются.
ALTER TYPE "ProposalJobKind" ADD VALUE 'UPLOAD_MEDIA';
ALTER TYPE "ProposalJobKind" ADD VALUE 'COPY_PRODUCT_MEDIA';

ALTER TABLE "ProposalMedia"
  ADD COLUMN "uploadState" TEXT NOT NULL DEFAULT 'READY',
  ADD COLUMN "uploadJobId" TEXT,
  ADD COLUMN "optimizedMimeType" TEXT NOT NULL DEFAULT 'image/jpeg';

CREATE UNIQUE INDEX "ProposalMedia_uploadJobId_key" ON "ProposalMedia"("uploadJobId");
ALTER TABLE "ProposalMedia"
  ADD CONSTRAINT "ProposalMedia_uploadJobId_fkey" FOREIGN KEY ("uploadJobId") REFERENCES "ProposalJob"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProposalMedia_upload_state_check" CHECK ("uploadState" IN ('PENDING', 'READY')),
  ADD CONSTRAINT "ProposalMedia_pending_job_check" CHECK ("uploadState" <> 'PENDING' OR "uploadJobId" IS NOT NULL),
  ADD CONSTRAINT "ProposalMedia_optimized_mime_check" CHECK ("optimizedMimeType" IN ('image/jpeg', 'image/png', 'image/webp'));

CREATE FUNCTION kp_validate_media_upload_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."uploadJobId" IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "ProposalJob" j WHERE j.id = NEW."uploadJobId" AND j."proposalId" = NEW."proposalId"
      AND j.kind::text = 'UPLOAD_MEDIA' AND j.payload->>'kind' = 'UPLOAD_MEDIA' AND j.payload->>'mediaId' = NEW.id
      AND j.payload->'binding' = NEW."storageBinding"
      AND (j.payload->'original'->>'key') IS NOT DISTINCT FROM NEW."originalKey" AND j.payload->'optimized'->>'key' = NEW."optimizedKey"
      AND (j.payload->'original'->>'sha256') IS NOT DISTINCT FROM NEW."originalHash" AND j.payload->'optimized'->>'sha256' = NEW."optimizedHash"
      AND ((j.payload->'original'->>'size')::bigint) IS NOT DISTINCT FROM NEW."originalSize" AND (j.payload->'optimized'->>'size')::bigint = NEW."optimizedSize"
      AND COALESCE(j.payload->'original'->>'mimeType',j.payload->'optimized'->>'mimeType') = NEW."mimeType" AND j.payload->'optimized'->>'mimeType' = NEW."optimizedMimeType"
  ) THEN
    RAISE EXCEPTION 'KP_MEDIA_UPLOAD_OWNER_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ProposalMedia_validate_upload" BEFORE INSERT OR UPDATE OF "proposalId", "storageBinding", "originalKey", "optimizedKey",
  "originalHash", "optimizedHash", "originalSize", "optimizedSize", "mimeType", "optimizedMimeType", "uploadJobId"
  ON "ProposalMedia" FOR EACH ROW EXECUTE FUNCTION kp_validate_media_upload_binding();

ALTER TABLE "File"
  ADD COLUMN "proposalSourceItemId" TEXT,
  ADD COLUMN "proposalSourceMediaId" TEXT,
  ADD COLUMN "proposalMediaCopyJobId" TEXT,
  ADD COLUMN "proposalMediaRetiredAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "File_proposalMediaCopyJobId_key" ON "File"("proposalMediaCopyJobId");
CREATE INDEX "File_proposal_media_source_idx" ON "File"("proposalSourceItemId", "proposalSourceMediaId", "proposalMediaRetiredAt");
ALTER TABLE "File"
  ADD CONSTRAINT "File_proposalSourceItemId_fkey" FOREIGN KEY ("proposalSourceItemId") REFERENCES "ProposalItem"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "File_proposalSourceMediaId_fkey" FOREIGN KEY ("proposalSourceMediaId") REFERENCES "ProposalMedia"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "File_proposalMediaCopyJobId_fkey" FOREIGN KEY ("proposalMediaCopyJobId") REFERENCES "ProposalJob"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "File_proposal_media_source_check" CHECK (
    ("proposalSourceItemId" IS NULL AND "proposalSourceMediaId" IS NULL AND "proposalMediaCopyJobId" IS NULL AND "proposalMediaRetiredAt" IS NULL)
    OR ("proposalSourceItemId" IS NOT NULL AND "proposalSourceMediaId" IS NOT NULL AND "proposalMediaCopyJobId" IS NOT NULL AND "productId" IS NOT NULL)
  );

-- Строка File не может выдать чужое медиа или произвольный обычный объект за управляемую копию КП.
CREATE FUNCTION kp_validate_managed_product_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."proposalMediaCopyJobId" IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "ProposalJob" j
    JOIN "ProposalItem" i ON i.id = NEW."proposalSourceItemId" AND i."proposalId" = j."proposalId"
    JOIN "ProposalMedia" m ON m.id = NEW."proposalSourceMediaId" AND m."proposalId" = j."proposalId"
    JOIN "CommercialProposal" cp ON cp.id = j."proposalId"
    WHERE j.id = NEW."proposalMediaCopyJobId" AND j.kind::text = 'COPY_PRODUCT_MEDIA' AND j.state::text = 'SUCCEEDED'
      AND j.result->>'copyReady' = 'true' AND NEW."uploadedById" = j."createdById"
      AND cp."projectId" = NEW."projectId" AND i."productId" = NEW."productId"
      AND j.payload->>'kind' = 'COPY_PRODUCT_MEDIA' AND j.payload->>'fileId' = NEW.id
      AND j.payload->>'itemId' = NEW."proposalSourceItemId" AND j.payload->>'mediaId' = NEW."proposalSourceMediaId"
      AND j.payload->>'storedName' = NEW."storedName" AND NEW."taskId" IS NULL AND NEW.section::text = 'PRODUCTION'
      AND j.payload->'optimized'->>'key' = NEW."projectId" || '/' || NEW."storedName"
      AND (j.payload->'optimized'->>'size')::bigint = NEW.size
      AND j.payload->'optimized'->>'mimeType' = NEW."mimeType"
  ) THEN
    RAISE EXCEPTION 'KP_MANAGED_FILE_OWNER_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "File_validate_proposal_media" BEFORE INSERT OR UPDATE OF "projectId", "productId", "taskId", section,
  "storedName", "mimeType", size, "proposalSourceItemId", "proposalSourceMediaId", "proposalMediaCopyJobId"
  ON "File" FOR EACH ROW EXECUTE FUNCTION kp_validate_managed_product_file();
