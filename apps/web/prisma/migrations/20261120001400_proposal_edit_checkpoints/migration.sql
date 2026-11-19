ALTER TYPE "ProposalVersionTrigger" ADD VALUE IF NOT EXISTS 'EDIT';
ALTER TABLE "ProposalContract" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "deletedById" TEXT;
