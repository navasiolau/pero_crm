-- Native acceptance on a disposable restored CRM clone AFTER migrate deploy.
-- psql -X -v ON_ERROR_STOP=1 -U postgres -d pero_auth_test_<suffix> -f ...
-- No production rows are changed; every fixture and assertion rolls back.
BEGIN;
DO $$
DECLARE marker text;
BEGIN
  SELECT shobj_description(oid, 'pg_database') INTO marker
    FROM pg_database WHERE datname = current_database();
  IF current_database() !~ '^pero_auth_test_[a-z0-9_]+$'
     OR marker IS DISTINCT FROM 'PERO_AUTH_TEST_DISPOSABLE' THEN
    RAISE EXCEPTION 'Refusing unmarked/non-test database';
  END IF;
END;
$$;

INSERT INTO "User" (id, email, name, "passwordHash", roles, active, "updatedAt") VALUES
  ('auth-revoke-fixture-a', 'auth-revoke-a@example.invalid', 'Security fixture A', 'fixture-hash-1', ARRAY['ADMIN']::"Role"[], true, CURRENT_TIMESTAMP),
  ('auth-revoke-fixture-b', 'auth-revoke-b@example.invalid', 'Security fixture B', 'fixture-hash-1', ARRAY['MANAGER']::"Role"[], true, CURRENT_TIMESTAMP);
INSERT INTO "ApiToken" (id, name, prefix, "tokenHash", scopes, "createdById") VALUES
  ('auth-revoke-token-a', 'Security fixture A', 'fixture-a', 'auth-revoke-hash-a', ARRAY['write'], 'auth-revoke-fixture-a'),
  ('auth-revoke-token-b', 'Security fixture B', 'fixture-b', 'auth-revoke-hash-b', ARRAY['write'], 'auth-revoke-fixture-b'),
  ('auth-revoke-token-service', 'Security fixture service', 'fixture-service', 'auth-revoke-hash-service', ARRAY['write'], NULL);

DO $$
DECLARE current_version integer;
BEGIN
  UPDATE "User" SET name = 'Renamed fixture' WHERE id = 'auth-revoke-fixture-a';
  SELECT "sessionVersion" INTO current_version FROM "User" WHERE id = 'auth-revoke-fixture-a';
  IF current_version <> 0 THEN RAISE EXCEPTION 'Unrelated profile change revoked'; END IF;

  UPDATE "User" SET "passwordHash" = 'fixture-hash-2' WHERE id = 'auth-revoke-fixture-a';
  SELECT "sessionVersion" INTO current_version FROM "User" WHERE id = 'auth-revoke-fixture-a';
  IF current_version <> 1 THEN RAISE EXCEPTION 'Password change did not revoke web sessions'; END IF;
  IF (SELECT "revokedAt" IS NOT NULL FROM "ApiToken" WHERE id = 'auth-revoke-token-a') THEN
    RAISE EXCEPTION 'Password-only change must preserve separate API credentials';
  END IF;

  UPDATE "User" SET roles = ARRAY['WORKER']::"Role"[] WHERE id = 'auth-revoke-fixture-a';
  SELECT "sessionVersion" INTO current_version FROM "User" WHERE id = 'auth-revoke-fixture-a';
  IF current_version <> 2 THEN RAISE EXCEPTION 'Role change did not revoke sessions'; END IF;
  IF (SELECT "revokedAt" IS NULL FROM "ApiToken" WHERE id = 'auth-revoke-token-a') THEN
    RAISE EXCEPTION 'Role change did not revoke owned API credentials';
  END IF;

  UPDATE "User" SET "sessionVersion" = 0 WHERE id = 'auth-revoke-fixture-a';
  SELECT "sessionVersion" INTO current_version FROM "User" WHERE id = 'auth-revoke-fixture-a';
  IF current_version <> 2 THEN RAISE EXCEPTION 'Version rewind resurrected old cookies'; END IF;

  UPDATE "User" SET "sessionVersion" = "sessionVersion" + 1 WHERE id = 'auth-revoke-fixture-a';
  SELECT "sessionVersion" INTO current_version FROM "User" WHERE id = 'auth-revoke-fixture-a';
  IF current_version <> 3 THEN RAISE EXCEPTION 'Explicit revoke did not advance version'; END IF;

  UPDATE "User" SET email = 'auth-revoke-new-a@example.invalid' WHERE id = 'auth-revoke-fixture-a';
  SELECT "sessionVersion" INTO current_version FROM "User" WHERE id = 'auth-revoke-fixture-a';
  IF current_version <> 4 THEN RAISE EXCEPTION 'Email change did not revoke sessions'; END IF;

  UPDATE "User" SET active = false WHERE id = 'auth-revoke-fixture-b';
  SELECT "sessionVersion" INTO current_version FROM "User" WHERE id = 'auth-revoke-fixture-b';
  IF current_version <> 1 THEN RAISE EXCEPTION 'Deactivation did not revoke sessions'; END IF;
  IF (SELECT "revokedAt" IS NULL FROM "ApiToken" WHERE id = 'auth-revoke-token-b') THEN
    RAISE EXCEPTION 'Deactivation did not revoke owned API credentials';
  END IF;

  UPDATE "User" SET active = true WHERE id = 'auth-revoke-fixture-b';
  SELECT "sessionVersion" INTO current_version FROM "User" WHERE id = 'auth-revoke-fixture-b';
  IF current_version <> 2 THEN RAISE EXCEPTION 'Reactivation did not advance version'; END IF;
  IF (SELECT "revokedAt" IS NULL FROM "ApiToken" WHERE id = 'auth-revoke-token-b') THEN
    RAISE EXCEPTION 'Reactivation revived old API credentials';
  END IF;
  SELECT "sessionVersion" INTO current_version FROM "User" WHERE id = 'auth-revoke-fixture-a';
  IF current_version <> 4 THEN RAISE EXCEPTION 'Unrelated account affected'; END IF;

  UPDATE "User" SET "passwordHash" = 'fixture-hash-2' WHERE id = 'auth-revoke-fixture-a';
  SELECT "sessionVersion" INTO current_version FROM "User" WHERE id = 'auth-revoke-fixture-a';
  IF current_version <> 4 THEN RAISE EXCEPTION 'Identical credentials revoked again'; END IF;
  IF (SELECT "revokedAt" IS NOT NULL FROM "ApiToken" WHERE id = 'auth-revoke-token-service') THEN
    RAISE EXCEPTION 'Independent service token affected';
  END IF;

  INSERT INTO "ApiToken" (id, name, prefix, "tokenHash", scopes, "createdById") VALUES
    ('auth-revoke-token-delete', 'Delete fixture', 'fixture-delete', 'auth-revoke-hash-delete', ARRAY['read'], 'auth-revoke-fixture-a');
  DELETE FROM "User" WHERE id = 'auth-revoke-fixture-a';
  IF (SELECT "revokedAt" IS NULL FROM "ApiToken" WHERE id = 'auth-revoke-token-delete') THEN
    RAISE EXCEPTION 'Deleting owner did not revoke owned API credentials';
  END IF;
  -- Simulate a current/future FK with ON DELETE SET NULL; the revoked token
  -- must remain revoked rather than becoming an ownerless service token.
  UPDATE "ApiToken" SET "createdById" = NULL WHERE id = 'auth-revoke-token-delete';
  IF (SELECT "revokedAt" IS NULL FROM "ApiToken" WHERE id = 'auth-revoke-token-delete') THEN
    RAISE EXCEPTION 'Null ownership resurrected a deleted user token';
  END IF;
END;
$$;
ROLLBACK;
SELECT 'PASS: native PostgreSQL credential revocation; fixture changes rolled back' AS result;
