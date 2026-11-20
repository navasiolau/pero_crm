ALTER TABLE "ProposalVersion"
  DROP CONSTRAINT "ProposalVersion_pdf_check",
  ADD CONSTRAINT "ProposalVersion_pdf_check" CHECK (
    ("trigger" = 'EDIT' AND "pdfArtifactId" IS NULL)
    OR "trigger" = 'IMPORT'
    OR ("trigger" IN ('PDF', 'CONTRACT') AND "pdfArtifactId" IS NOT NULL)
  );
