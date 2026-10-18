-- CreateEnum
CREATE TYPE "ProposalCurrency" AS ENUM ('BYN', 'RUB', 'USD', 'EUR');

-- CreateEnum
CREATE TYPE "ProposalRateSource" AS ENUM ('NBRB', 'MANUAL');

-- CreateEnum
CREATE TYPE "ProposalVersionTrigger" AS ENUM ('PDF', 'CONTRACT', 'IMPORT');

-- CreateEnum
CREATE TYPE "ProposalArtifactKind" AS ENUM ('PDF', 'DOCX');

-- CreateEnum
CREATE TYPE "ProposalArtifactState" AS ENUM ('PENDING', 'READY', 'RETIRING', 'DELETED');

-- CreateEnum
CREATE TYPE "ProposalJobKind" AS ENUM ('PDF', 'CONTRACT', 'PRUNE_VERSIONS', 'PURGE_MEDIA');

-- CreateEnum
CREATE TYPE "ProposalJobState" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "CommercialProposal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "clientId" TEXT,
    "sourceId" TEXT,
    "sourceNumber" TEXT,
    "isArchive" BOOLEAN NOT NULL DEFAULT false,
    "state" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "currency" "ProposalCurrency" NOT NULL DEFAULT 'BYN',
    "rate" DECIMAL(20,10),
    "rateDate" DATE,
    "rateSource" "ProposalRateSource",
    "acceptedVersionId" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "retentionEpoch" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalItem" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "productId" TEXT,
    "position" INTEGER NOT NULL,
    "state" JSONB NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalVersion" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "trigger" "ProposalVersionTrigger" NOT NULL,
    "state" JSONB NOT NULL,
    "pricingSnapshot" JSONB NOT NULL,
    "renderSnapshot" JSONB NOT NULL DEFAULT '{}',
    "templateVersion" TEXT NOT NULL,
    "pdfArtifactId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalMedia" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "storageBinding" JSONB NOT NULL,
    "originalKey" TEXT,
    "optimizedKey" TEXT,
    "originalHash" TEXT,
    "optimizedHash" TEXT,
    "originalSize" INTEGER,
    "optimizedSize" INTEGER,
    "mimeType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "originalPurgedAt" TIMESTAMP(3),
    "optimizedPurgedAt" TIMESTAMP(3),
    "retiringAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalCurrentMedia" (
    "proposalId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,

    CONSTRAINT "ProposalCurrentMedia_pkey" PRIMARY KEY ("proposalId","mediaId")
);

-- CreateTable
CREATE TABLE "ProposalVersionMedia" (
    "proposalId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,

    CONSTRAINT "ProposalVersionMedia_pkey" PRIMARY KEY ("versionId","mediaId")
);

-- CreateTable
CREATE TABLE "ProposalArtifact" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT,
    "contractId" TEXT,
    "kind" "ProposalArtifactKind" NOT NULL,
    "state" "ProposalArtifactState" NOT NULL DEFAULT 'PENDING',
    "storageBinding" JSONB NOT NULL,
    "key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProposalArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalContract" (
    "id" TEXT NOT NULL,
    "primaryProposalId" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalContractSource" (
    "contractId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ProposalContractSource_pkey" PRIMARY KEY ("contractId","proposalId")
);

-- CreateTable
CREATE TABLE "ProposalContractVersion" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "settingsSnapshot" JSONB NOT NULL,
    "clientSnapshot" JSONB NOT NULL,
    "sourcesSnapshot" JSONB NOT NULL,
    "renderSnapshot" JSONB NOT NULL DEFAULT '{}',
    "templateVersion" TEXT NOT NULL,
    "docxArtifactId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalContractVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalJob" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT,
    "contractId" TEXT,
    "kind" "ProposalJobKind" NOT NULL,
    "state" "ProposalJobState" NOT NULL DEFAULT 'PENDING',
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "retentionEpoch" INTEGER,
    "lastErrorCode" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommercialProposal_projectId_key" ON "CommercialProposal"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialProposal_sourceId_key" ON "CommercialProposal"("sourceId");

-- CreateIndex
CREATE INDEX "CommercialProposal_createdAt_idx" ON "CommercialProposal"("createdAt");

-- CreateIndex
CREATE INDEX "CommercialProposal_clientId_idx" ON "CommercialProposal"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalItem_productId_key" ON "ProposalItem"("productId");

-- CreateIndex
CREATE INDEX "ProposalItem_proposalId_position_idx" ON "ProposalItem"("proposalId", "position");

-- CreateIndex
CREATE INDEX "ProposalVersion_proposalId_createdAt_idx" ON "ProposalVersion"("proposalId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalVersion_proposalId_id_key" ON "ProposalVersion"("proposalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalMedia_originalKey_key" ON "ProposalMedia"("originalKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalMedia_optimizedKey_key" ON "ProposalMedia"("optimizedKey");

-- CreateIndex
CREATE INDEX "ProposalMedia_expiresAt_idx" ON "ProposalMedia"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalMedia_proposalId_id_key" ON "ProposalMedia"("proposalId", "id");

-- CreateIndex
CREATE INDEX "ProposalVersionMedia_proposalId_mediaId_idx" ON "ProposalVersionMedia"("proposalId", "mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalArtifact_key_key" ON "ProposalArtifact"("key");

-- CreateIndex
CREATE INDEX "ProposalArtifact_proposalId_state_idx" ON "ProposalArtifact"("proposalId", "state");

-- CreateIndex
CREATE INDEX "ProposalArtifact_contractId_state_idx" ON "ProposalArtifact"("contractId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalArtifact_proposalId_id_key" ON "ProposalArtifact"("proposalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalArtifact_contractId_id_key" ON "ProposalArtifact"("contractId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalContract_primaryProposalId_key" ON "ProposalContract"("primaryProposalId");

-- CreateIndex
CREATE INDEX "ProposalContractSource_proposalId_idx" ON "ProposalContractSource"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalContractSource_contractId_position_key" ON "ProposalContractSource"("contractId", "position");

-- CreateIndex
CREATE INDEX "ProposalContractVersion_contractId_createdAt_idx" ON "ProposalContractVersion"("contractId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalJob_dedupeKey_key" ON "ProposalJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "ProposalJob_state_availableAt_idx" ON "ProposalJob"("state", "availableAt");

-- CreateIndex
CREATE INDEX "ProposalJob_proposalId_idx" ON "ProposalJob"("proposalId");

-- CreateIndex
CREATE INDEX "ProposalJob_contractId_idx" ON "ProposalJob"("contractId");

-- AddForeignKey
ALTER TABLE "CommercialProposal" ADD CONSTRAINT "CommercialProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialProposal" ADD CONSTRAINT "CommercialProposal_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialProposal" ADD CONSTRAINT "CommercialProposal_id_acceptedVersionId_fkey" FOREIGN KEY ("id", "acceptedVersionId") REFERENCES "ProposalVersion"("proposalId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProposalItem" ADD CONSTRAINT "ProposalItem_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CommercialProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalItem" ADD CONSTRAINT "ProposalItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalVersion" ADD CONSTRAINT "ProposalVersion_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CommercialProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalVersion" ADD CONSTRAINT "ProposalVersion_proposalId_pdfArtifactId_fkey" FOREIGN KEY ("proposalId", "pdfArtifactId") REFERENCES "ProposalArtifact"("proposalId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProposalMedia" ADD CONSTRAINT "ProposalMedia_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CommercialProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalCurrentMedia" ADD CONSTRAINT "ProposalCurrentMedia_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CommercialProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalCurrentMedia" ADD CONSTRAINT "ProposalCurrentMedia_proposalId_mediaId_fkey" FOREIGN KEY ("proposalId", "mediaId") REFERENCES "ProposalMedia"("proposalId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProposalVersionMedia" ADD CONSTRAINT "ProposalVersionMedia_proposalId_versionId_fkey" FOREIGN KEY ("proposalId", "versionId") REFERENCES "ProposalVersion"("proposalId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProposalVersionMedia" ADD CONSTRAINT "ProposalVersionMedia_proposalId_mediaId_fkey" FOREIGN KEY ("proposalId", "mediaId") REFERENCES "ProposalMedia"("proposalId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProposalArtifact" ADD CONSTRAINT "ProposalArtifact_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CommercialProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalArtifact" ADD CONSTRAINT "ProposalArtifact_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ProposalContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalContract" ADD CONSTRAINT "ProposalContract_primaryProposalId_fkey" FOREIGN KEY ("primaryProposalId") REFERENCES "CommercialProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalContractSource" ADD CONSTRAINT "ProposalContractSource_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ProposalContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalContractSource" ADD CONSTRAINT "ProposalContractSource_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CommercialProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalContractVersion" ADD CONSTRAINT "ProposalContractVersion_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ProposalContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalContractVersion" ADD CONSTRAINT "ProposalContractVersion_contractId_docxArtifactId_fkey" FOREIGN KEY ("contractId", "docxArtifactId") REFERENCES "ProposalArtifact"("contractId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ProposalJob" ADD CONSTRAINT "ProposalJob_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CommercialProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalJob" ADD CONSTRAINT "ProposalJob_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ProposalContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Принадлежность снимков и файлов проверяется самой БД, включая прямые SQL writers.
CREATE FUNCTION kp_json_object_array(candidate JSONB) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT CASE WHEN jsonb_typeof(candidate) = 'array' THEN
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(candidate) AS entry WHERE jsonb_typeof(entry) <> 'object')
  ELSE FALSE END
$$;

CREATE FUNCTION kp_valid_state(candidate JSONB) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT jsonb_typeof(candidate) = 'object'
    AND candidate ? 'items'
    AND COALESCE(kp_json_object_array(candidate -> 'items'), FALSE)
$$;

CREATE FUNCTION kp_valid_storage_binding(candidate JSONB) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT jsonb_typeof(candidate) = 'object'
    AND candidate ? 'endpoint' AND candidate ? 'bucket'
    AND jsonb_typeof(candidate -> 'endpoint') = 'string'
    AND jsonb_typeof(candidate -> 'bucket') = 'string'
    AND length(candidate ->> 'bucket') BETWEEN 1 AND 255
    AND (candidate ->> 'bucket') !~ '[[:space:][:cntrl:]]'
    AND position('/' IN candidate ->> 'bucket') = 0 AND position(chr(92) IN candidate ->> 'bucket') = 0
    AND (candidate ->> 'endpoint') ~* '^https?://[^/@?#[:space:]]+(/[^?#[:space:]]*)?$'
    AND position(chr(92) IN candidate ->> 'endpoint') = 0
    AND (NOT candidate ? 'region' OR (jsonb_typeof(candidate -> 'region') = 'string' AND length(candidate ->> 'region') BETWEEN 1 AND 255 AND (candidate ->> 'region') !~ '[[:space:][:cntrl:]]'))
    AND candidate - ARRAY['endpoint', 'bucket', 'region']::TEXT[] = '{}'::JSONB
$$;

CREATE FUNCTION kp_valid_object_key(candidate TEXT) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE STRICT AS $$
  SELECT length(candidate) BETWEEN 4 AND 1024
    AND candidate ~ '^kp/[A-Za-z0-9][A-Za-z0-9/._-]*$'
    AND candidate !~ '(^|/)[.]{1,2}(/|$)'
    AND position('//' IN candidate) = 0
    AND right(candidate, 1) <> '/'
$$;

ALTER TABLE "CommercialProposal"
  ADD CONSTRAINT "CommercialProposal_state_check" CHECK (kp_valid_state("state")),
  ADD CONSTRAINT "CommercialProposal_revision_check" CHECK ("revision" >= 0 AND "retentionEpoch" >= 0),
  ADD CONSTRAINT "CommercialProposal_rate_check" CHECK (
    ("rate" IS NULL AND "rateDate" IS NULL AND "rateSource" IS NULL)
    OR ("rate" IS NOT NULL AND "rateDate" IS NOT NULL AND "rateSource" IS NOT NULL
      AND "rate" > 0 AND "rate" <> 'NaN'::NUMERIC AND ("currency" <> 'BYN' OR "rate" = 1))
  ),
  ADD CONSTRAINT "CommercialProposal_accepted_check" CHECK (("acceptedVersionId" IS NULL) = ("acceptedAt" IS NULL));

ALTER TABLE "ProposalItem"
  ADD CONSTRAINT "ProposalItem_position_check" CHECK ("position" > 0),
  ADD CONSTRAINT "ProposalItem_state_check" CHECK (jsonb_typeof("state") = 'object');

CREATE UNIQUE INDEX "ProposalItem_active_position_key" ON "ProposalItem"("proposalId", "position") WHERE "deletedAt" IS NULL;

ALTER TABLE "ProposalVersion"
  ADD CONSTRAINT "ProposalVersion_revision_check" CHECK ("revision" >= 0),
  ADD CONSTRAINT "ProposalVersion_state_check" CHECK (kp_valid_state("state") AND jsonb_typeof("pricingSnapshot") = 'object' AND jsonb_typeof("renderSnapshot") = 'object'),
  ADD CONSTRAINT "ProposalVersion_template_check" CHECK (length(trim("templateVersion")) > 0),
  ADD CONSTRAINT "ProposalVersion_pdf_check" CHECK ("trigger" = 'IMPORT' OR "pdfArtifactId" IS NOT NULL);

ALTER TABLE "ProposalMedia"
  ADD CONSTRAINT "ProposalMedia_storage_check" CHECK (kp_valid_storage_binding("storageBinding")),
  ADD CONSTRAINT "ProposalMedia_original_check" CHECK (
    ("originalKey" IS NULL AND "originalHash" IS NULL AND "originalSize" IS NULL AND "originalPurgedAt" IS NULL)
    OR ("originalKey" IS NOT NULL AND "originalHash" IS NOT NULL AND "originalSize" IS NOT NULL
      AND kp_valid_object_key("originalKey") AND starts_with("originalKey", 'kp/proposals/' || "proposalId" || '/original/')
      AND "originalHash" ~ '^[a-f0-9]{64}$' AND "originalSize" > 0)
  ),
  ADD CONSTRAINT "ProposalMedia_optimized_check" CHECK (
    ("optimizedKey" IS NULL AND "optimizedHash" IS NULL AND "optimizedSize" IS NULL AND "optimizedPurgedAt" IS NULL)
    OR ("optimizedKey" IS NOT NULL AND "optimizedHash" IS NOT NULL AND "optimizedSize" IS NOT NULL
      AND kp_valid_object_key("optimizedKey") AND starts_with("optimizedKey", 'kp/proposals/' || "proposalId" || '/optimized/')
      AND "optimizedHash" ~ '^[a-f0-9]{64}$' AND "optimizedSize" > 0)
  ),
  ADD CONSTRAINT "ProposalMedia_variants_check" CHECK ("originalKey" IS NOT NULL OR "optimizedKey" IS NOT NULL),
  ADD CONSTRAINT "ProposalMedia_dimensions_check" CHECK (("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0)),
  ADD CONSTRAINT "ProposalMedia_type_check" CHECK ("mimeType" IN ('image/jpeg', 'image/png', 'image/webp'));

ALTER TABLE "ProposalArtifact"
  ADD CONSTRAINT "ProposalArtifact_owner_check" CHECK (("proposalId" IS NOT NULL) <> ("contractId" IS NOT NULL)),
  ADD CONSTRAINT "ProposalArtifact_kind_check" CHECK (
    ("proposalId" IS NOT NULL AND "kind" = 'PDF' AND "mimeType" = 'application/pdf')
    OR ("contractId" IS NOT NULL AND "kind" = 'DOCX' AND "mimeType" = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  ),
  ADD CONSTRAINT "ProposalArtifact_storage_check" CHECK (kp_valid_storage_binding("storageBinding")),
  ADD CONSTRAINT "ProposalArtifact_key_check" CHECK (kp_valid_object_key("key") AND (
    ("proposalId" IS NOT NULL AND starts_with("key", 'kp/proposals/' || "proposalId" || '/exports/'))
    OR ("contractId" IS NOT NULL AND starts_with("key", 'kp/contracts/' || "contractId" || '/exports/'))
  )),
  ADD CONSTRAINT "ProposalArtifact_content_check" CHECK ("size" > 0 AND "sha256" ~ '^[a-f0-9]{64}$' AND length(trim("fileName")) > 0),
  ADD CONSTRAINT "ProposalArtifact_deleted_check" CHECK (("state" = 'DELETED') = ("deletedAt" IS NOT NULL));

ALTER TABLE "ProposalContract"
  ADD CONSTRAINT "ProposalContract_revision_check" CHECK ("revision" >= 0),
  ADD CONSTRAINT "ProposalContract_settings_check" CHECK (jsonb_typeof("settings") = 'object');

ALTER TABLE "ProposalContractSource"
  ADD CONSTRAINT "ProposalContractSource_position_check" CHECK ("position" > 0);

ALTER TABLE "ProposalContractVersion"
  ADD CONSTRAINT "ProposalContractVersion_snapshots_check" CHECK (
    jsonb_typeof("settingsSnapshot") = 'object' AND jsonb_typeof("clientSnapshot") = 'object'
    AND jsonb_typeof("renderSnapshot") = 'object' AND kp_json_object_array("sourcesSnapshot")
  ),
  ADD CONSTRAINT "ProposalContractVersion_template_check" CHECK (length(trim("templateVersion")) > 0);

ALTER TABLE "ProposalJob"
  ADD CONSTRAINT "ProposalJob_owner_check" CHECK (
    ("kind" = 'CONTRACT' AND "contractId" IS NOT NULL AND "proposalId" IS NULL)
    OR ("kind" <> 'CONTRACT' AND "proposalId" IS NOT NULL AND "contractId" IS NULL)
  ),
  ADD CONSTRAINT "ProposalJob_payload_check" CHECK (jsonb_typeof("payload") = 'object' AND ("result" IS NULL OR jsonb_typeof("result") = 'object')),
  ADD CONSTRAINT "ProposalJob_attempts_check" CHECK ("attempts" >= 0 AND "maxAttempts" > 0 AND "attempts" <= "maxAttempts"),
  ADD CONSTRAINT "ProposalJob_dedupe_check" CHECK (length(trim("dedupeKey")) > 0),
  ADD CONSTRAINT "ProposalJob_retention_check" CHECK ("retentionEpoch" IS NULL OR "retentionEpoch" >= 0),
  ADD CONSTRAINT "ProposalJob_lease_check" CHECK (
    ("state" = 'PROCESSING' AND "leaseOwner" IS NOT NULL AND length(trim("leaseOwner")) > 0 AND "leaseUntil" IS NOT NULL)
    OR ("state" <> 'PROCESSING' AND "leaseOwner" IS NULL AND "leaseUntil" IS NULL)
  );

-- Выпуск фиксируется целиком после успешного рендера; очистка удаляет старую строку, но не переписывает снимок.
CREATE FUNCTION kp_reject_version_update() RETURNS TRIGGER
LANGUAGE PLPGSQL AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'KP_VERSION_IMMUTABLE';
END
$$;

CREATE TRIGGER "ProposalVersion_immutable" BEFORE UPDATE ON "ProposalVersion"
FOR EACH ROW EXECUTE FUNCTION kp_reject_version_update();

CREATE TRIGGER "ProposalContractVersion_immutable" BEFORE UPDATE ON "ProposalContractVersion"
FOR EACH ROW EXECUTE FUNCTION kp_reject_version_update();

-- Выпущенная версия ссылается на идентичность файла, а не на заменяемый адрес объекта.
CREATE FUNCTION kp_reject_artifact_rebind() RETURNS TRIGGER
LANGUAGE PLPGSQL AS $$
BEGIN
  IF ROW(NEW."id", NEW."proposalId", NEW."contractId", NEW."kind", NEW."storageBinding", NEW."key", NEW."sha256", NEW."size", NEW."fileName", NEW."mimeType", NEW."createdAt")
    IS DISTINCT FROM ROW(OLD."id", OLD."proposalId", OLD."contractId", OLD."kind", OLD."storageBinding", OLD."key", OLD."sha256", OLD."size", OLD."fileName", OLD."mimeType", OLD."createdAt") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'KP_ARTIFACT_IDENTITY_IMMUTABLE';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "ProposalArtifact_identity_immutable" BEFORE UPDATE ON "ProposalArtifact"
FOR EACH ROW EXECUTE FUNCTION kp_reject_artifact_rebind();
