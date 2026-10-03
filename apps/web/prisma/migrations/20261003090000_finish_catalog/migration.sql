CREATE TYPE "FinishKind" AS ENUM ('ENAMEL', 'VENEER', 'COATING');
CREATE TABLE "Finish" (
  "id" UUID NOT NULL,
  "kind" "FinishKind" NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Finish_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Finish_kind_code_key" ON "Finish"("kind", "code");
CREATE INDEX "Finish_active_kind_idx" ON "Finish"("active", "kind");
