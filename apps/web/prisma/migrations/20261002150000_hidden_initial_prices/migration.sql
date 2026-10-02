-- Existing rows, including legacy NULL snapshots, never become capture-eligible.
ALTER TABLE "Product" ADD COLUMN "initialPriceCaptureEligible" BOOLEAN NOT NULL DEFAULT false;
