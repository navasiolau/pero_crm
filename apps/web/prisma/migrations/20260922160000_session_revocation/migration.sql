-- Additive: old images can run with this column, but only the new image
-- enforces revocation. Do not roll back to an old image after a security revoke.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD CONSTRAINT "User_sessionVersion_nonnegative"
  CHECK ("sessionVersion" >= 0);

-- Database enforcement also covers a password reset performed by an operator
-- through SQL/Prisma, not only the user-management action in this application.
CREATE FUNCTION pero_revoke_user_credentials() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Revoke before a user deletion can null an ownership FK, now or in a
  -- future schema. A personal credential must never become a service key.
  IF TG_OP = 'DELETE' THEN
    UPDATE "ApiToken" SET "revokedAt" = CURRENT_TIMESTAMP
      WHERE "createdById" = OLD."id" AND "revokedAt" IS NULL;
    RETURN OLD;
  END IF;

  IF NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash"
     OR NEW."roles" IS DISTINCT FROM OLD."roles"
     OR NEW."active" IS DISTINCT FROM OLD."active"
     OR NEW."email" IS DISTINCT FROM OLD."email" THEN
    NEW."sessionVersion" := GREATEST(OLD."sessionVersion" + 1, NEW."sessionVersion");
  ELSE
    -- Never resurrect old sessions by accidentally writing an older version.
    NEW."sessionVersion" := GREATEST(OLD."sessionVersion", NEW."sessionVersion");
  END IF;

  -- User-owned API credentials are separate from web sessions. Deactivation
  -- or a role change revokes them permanently; reactivation does not revive
  -- old keys. A password-only reset does not rotate integration credentials.
  IF (OLD."active" AND NOT NEW."active")
     OR NEW."roles" IS DISTINCT FROM OLD."roles" THEN
    UPDATE "ApiToken" SET "revokedAt" = CURRENT_TIMESTAMP
      WHERE "createdById" = OLD."id" AND "revokedAt" IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER pero_user_credential_revocation
BEFORE UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION pero_revoke_user_credentials();

CREATE TRIGGER pero_user_delete_credential_revocation
BEFORE DELETE ON "User"
FOR EACH ROW EXECUTE FUNCTION pero_revoke_user_credentials();

-- Close existing dangling/disabled ownership without affecting intentionally
-- ownerless service credentials (createdById IS NULL).
UPDATE "ApiToken" AS token SET "revokedAt" = CURRENT_TIMESTAMP
WHERE token."createdById" IS NOT NULL AND token."revokedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "User" AS account
    WHERE account."id" = token."createdById" AND account."active"
  );
