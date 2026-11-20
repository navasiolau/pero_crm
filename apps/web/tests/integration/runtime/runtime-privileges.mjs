import { docker, inspectService } from './containers.mjs';
import { requireCi } from './target.mjs';

/** @param {import('./target.mjs').CiJob} target */
export function proveRuntimePrivileges(target) {
  inspectService(target, target.postgresId, 'postgres');
  const login = `ci_pero_runtime_${target.runId}_${target.attempt}`;
  const synthetic = `ci-only-${target.runId}-${target.attempt}`;
  requireCi(/^ci_pero_runtime_[1-9]\d*_[1-9]\d*$/.test(login) && login.length < 63 &&
    new URL(target.databaseUrl).password === synthetic, 'runtime-role-fixture');
  const base = ['exec', target.postgresId, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-d', 'pero_ci', '-At'];
  const owner = (sql) => docker([...base, '-U', 'ci_runner', '-c', sql]);
  const facts = JSON.parse(owner(`SELECT json_build_object('db',current_database(),'role',current_user,
    'primary',NOT pg_is_in_recovery(),'claimed',EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${login}'),
    'prismaTable', (SELECT relkind FROM pg_class WHERE oid = 'public._prisma_migrations'::regclass),
    'sequenceProbe', to_regclass('public.pero_ci_sequence_probe'),
    'group','pero_crm_runtime_' || left(md5(current_database()),16))`));
  requireCi(facts.db === 'pero_ci' && facts.role === 'ci_runner' && facts.primary && !facts.claimed &&
    facts.prismaTable === 'r' && facts.sequenceProbe === null &&
    /^pero_crm_runtime_[0-9a-f]{16}$/.test(facts.group), 'runtime-role-target');
  owner(`BEGIN;
    CREATE TABLE public.pero_ci_cascade_probe (id text REFERENCES public."FinanceDocument"(id) ON DELETE CASCADE);
    DO $check$
    BEGIN
      PERFORM public.pero_refresh_runtime_grants();
      RAISE EXCEPTION 'Unsafe fixture cascade was accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'CRM draft deletion must not cascade or modify another row' THEN RAISE; END IF;
    END
    $check$;
    ROLLBACK;`);
  owner(`REVOKE EXECUTE ON FUNCTION public.kp_valid_state(jsonb), public.pero_runtime_role_violations() FROM "${facts.group}"`);
  owner('SELECT public.pero_refresh_runtime_grants()');
  owner(`CREATE ROLE "${login}" LOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${synthetic}';
    GRANT "${facts.group}" TO "${login}" WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;`);
  const restricted = (sql) => docker(['exec', '-e', `PGPASSWORD=${synthetic}`, target.postgresId, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-h', '127.0.0.1', '-U', login, '-d', 'pero_ci', '-At', '-c', sql]);
  try {
    owner('CREATE SEQUENCE public.pero_ci_sequence_probe');
    const violations = () => JSON.parse(restricted('SELECT to_json(public.pero_runtime_role_violations())'));
    requireCi(JSON.stringify(violations()) === '[]', 'runtime-role-mixed-catalog');
    requireCi(restricted(`SELECT public.kp_valid_state('{"items":[]}'::jsonb)
      AND public.kp_json_object_array('[]'::jsonb)
      AND has_function_privilege(current_user, 'public.kp_valid_storage_binding(jsonb)', 'EXECUTE')
      AND has_function_privilege(current_user, 'public.kp_valid_object_key(text)', 'EXECUTE')`) === 't', 'runtime-proposal-check-functions');
    owner(`GRANT UPDATE ON SEQUENCE public.pero_ci_sequence_probe TO "${login}"`);
    requireCi(JSON.stringify(violations()) === '["sequence_mutation"]', 'runtime-role-detects-sequence-update');
    owner(`REVOKE UPDATE ON SEQUENCE public.pero_ci_sequence_probe FROM "${login}"`);
    requireCi(JSON.stringify(violations()) === '[]', 'runtime-role-sequence-restored');
    owner(`GRANT MAINTAIN ON TABLE public."Project" TO "${login}"`);
    try {
      requireCi(JSON.stringify(violations()) === '["table_mutation"]', 'runtime-role-detects-postgres17-maintain');
    } finally {
      owner(`REVOKE MAINTAIN ON TABLE public."Project" FROM "${login}"`);
    }
    owner("CREATE FUNCTION public.pero_ci_no_access() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 7'");
    const result = restricted(`
      BEGIN;
      DO $test$
      DECLARE command text;
      BEGIN
        IF session_user <> '${login}' OR current_user <> session_user OR cardinality(public.pero_runtime_role_violations()) <> 0 THEN
          RAISE EXCEPTION 'Unexpected CRM role scope: %', public.pero_runtime_role_violations();
        END IF;
        PERFORM id FROM public."Project" LIMIT 1;
        INSERT INTO public."OrgSetting"("key", "value", "updatedAt") VALUES ('ci-rights', 'initial', CURRENT_TIMESTAMP);
        UPDATE public."OrgSetting" SET "value" = 'changed' WHERE "key" = 'ci-rights';
        INSERT INTO public."User"(id,email,name,"passwordHash",roles,"updatedAt")
          VALUES ('ci-rights-actor','ci-rights@example.invalid','CI actor','no-login','{}',CURRENT_TIMESTAMP);
        INSERT INTO public."FinanceDocument"(id,"clientMutationId","requestFingerprint","uploadedById","fileName","mimeType",size,"contentHash","storageKey","storageMode")
          VALUES ('ci-rights-draft','ci-rights-draft','ci','ci-rights-actor','a.pdf','application/pdf',1,'a','ci-rights/a','s3'),
                 ('ci-rights-ready','ci-rights-ready','ci','ci-rights-actor','b.pdf','application/pdf',1,'b','ci-rights/b','s3');
        UPDATE public."FinanceDocument" SET state='READY',"readyAt"=CURRENT_TIMESTAMP WHERE id='ci-rights-ready';
        DELETE FROM public."FinanceDocument" WHERE id='ci-rights-draft';
        IF FOUND IS FALSE THEN RAISE EXCEPTION 'Expected narrow draft deletion'; END IF;
        FOREACH command IN ARRAY ARRAY[
          'DELETE FROM public."Project" WHERE false',
          'DELETE FROM public."CalendarEntry" WHERE false',
          'DELETE FROM public."TelegramLink" WHERE false',
          'TRUNCATE public."FinanceDocument"',
          'ALTER TABLE public."Project" ADD COLUMN denied boolean',
          'CREATE TABLE public.denied (id integer)',
          'UPDATE public."Project" SET id = id WHERE false',
          'UPDATE public."ChangeLog" SET action = action WHERE false',
          'UPDATE public."FinanceDocument" SET state = ''PENDING'', "readyAt" = NULL WHERE id = ''ci-rights-ready''',
          'DELETE FROM public."FinanceDocument" WHERE id = ''ci-rights-ready''',
          'SELECT public.pero_refresh_runtime_grants()',
          'SELECT public.pero_ci_no_access()',
          'SET ROLE "${facts.group}"',
          'SET ROLE ci_runner'
        ] LOOP
          BEGIN EXECUTE command;
            RAISE EXCEPTION 'Required denial did not happen: %', command;
          EXCEPTION WHEN insufficient_privilege THEN NULL;
          END;
        END LOOP;
        IF NOT EXISTS (SELECT 1 FROM public."FinanceDocument" WHERE id = 'ci-rights-ready' AND state = 'READY') THEN
          RAISE EXCEPTION 'Published document was lost';
        END IF;
      END
      $test$;
      ROLLBACK;
      SELECT 'crm runtime restrictions ok';
    `);
    requireCi(result.endsWith('crm runtime restrictions ok'), 'runtime-role-positive-negative');
    requireCi(owner('SELECT count(*) FROM public."OrgSetting" WHERE "key" = \'ci-rights\'') === '0', 'runtime-role-rolled-back');
    console.log(JSON.stringify({ ciRuntime: 'separate-runtime-role', nativePostgres: true, dataRolledBack: true }));
  } finally {
    owner("DROP SEQUENCE IF EXISTS public.pero_ci_sequence_probe");
    owner("DROP FUNCTION IF EXISTS public.pero_ci_no_access()");
    owner(`DROP ROLE "${login}"`);
  }
}
