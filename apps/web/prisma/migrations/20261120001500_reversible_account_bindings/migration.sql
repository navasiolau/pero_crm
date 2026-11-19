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

ALTER TABLE "User" ADD COLUMN "accountRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "NotificationPreference" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserPreference" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

CREATE FUNCTION "pero_track_account_revision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."accountRevision" := OLD."accountRevision";
  IF ROW(NEW.email,NEW.name,NEW.position,NEW.phone,NEW.telegram,NEW.roles,NEW."payScheme",NEW."payPercent",NEW.active,NEW."sessionVersion")
     IS DISTINCT FROM ROW(OLD.email,OLD.name,OLD.position,OLD.phone,OLD.telegram,OLD.roles,OLD."payScheme",OLD."payPercent",OLD.active,OLD."sessionVersion") THEN
    NEW."accountRevision" := OLD."accountRevision" + 1;
  END IF;
  RETURN NEW;
END
$$;
-- Порядок имени оставляет securityVersion trigger перед вычислением ревизии.
CREATE TRIGGER "zz_pero_track_account_revision" BEFORE UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION "pero_track_account_revision"();

CREATE TABLE "SavedListChoiceRevision" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "section" TEXT NOT NULL,
  "beforeQuery" TEXT NOT NULL,
  "beforeEngineerInitialized" BOOLEAN NOT NULL,
  "afterRevision" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedListChoiceRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SavedListChoiceRevision_section_check" CHECK ("section" IN ('projects','products','organizationExpenses')),
  CONSTRAINT "SavedListChoiceRevision_query_check" CHECK (length("beforeQuery") <= 16384)
);
CREATE INDEX "SavedListChoiceRevision_userId_section_idx" ON "SavedListChoiceRevision" ("userId", "section");
