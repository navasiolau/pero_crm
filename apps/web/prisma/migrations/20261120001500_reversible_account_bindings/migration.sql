ALTER TABLE "TelegramLink"
  ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "revokedAt" TIMESTAMP(3);
ALTER TABLE "TelegramReminderOutbox"
  ADD COLUMN "linkGenerationSnapshot" INTEGER NOT NULL DEFAULT 0;

-- Незавершённые plaintext-коды старого выпуска отзывает миграция. Действующие привязки сохраняются.
UPDATE "TelegramLink" SET "linkCode" = NULL, "linkCodeExpiresAt" = NULL WHERE "linkCode" IS NOT NULL;
CREATE TABLE "TelegramLinkChallenge" (
  "digest" TEXT NOT NULL,
  "linkId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramLinkChallenge_pkey" PRIMARY KEY ("digest"),
  CONSTRAINT "TelegramLinkChallenge_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "TelegramLink"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "TelegramLinkChallenge_linkId_idx" ON "TelegramLinkChallenge" ("linkId");
