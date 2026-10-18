-- Старые коммерческие суммы и исторические финансовые факты не меняются.
ALTER TABLE "Project"
  ADD COLUMN "servicesTotal" DECIMAL(12,2),
  ADD COLUMN "proposalRoundingAdjustment" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "Project"
  ADD CONSTRAINT "Project_services_mode_check" CHECK (
    "servicesTotal" IS NULL OR ("delivery" IS NULL AND "unloading" IS NULL AND "installation" IS NULL)
  ),
  ADD CONSTRAINT "Project_services_total_check" CHECK (
    "servicesTotal" IS NULL OR ("servicesTotal" >= 0 AND "servicesTotal" <> 'NaN'::NUMERIC)
  ),
  ADD CONSTRAINT "Project_proposal_rounding_check" CHECK ("proposalRoundingAdjustment" <> 'NaN'::NUMERIC);
