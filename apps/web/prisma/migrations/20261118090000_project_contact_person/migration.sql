ALTER TABLE "Client" ADD COLUMN "isContactPerson" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN "contactPerson" TEXT;
