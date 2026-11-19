-- Роль с грантами уникальна для БД, даже если несколько окружений используют один кластер.
DO $setup$
DECLARE runtime_role name := ('pero_crm_runtime_' || left(md5(current_database()), 16))::name;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', runtime_role);
  END IF;
END
$setup$;

-- READY — граница публикации. Обычная роль не может демонтировать этот триггер.
CREATE FUNCTION public.pero_guard_unpublished_document() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $guard$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state::text <> 'PENDING' OR OLD."readyAt" IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Published CRM documents are retained';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.state::text = 'PENDING' AND (OLD.state::text <> 'PENDING' OR OLD."readyAt" IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Published CRM documents cannot return to draft';
  END IF;
  IF OLD."readyAt" IS NOT NULL AND NEW."readyAt" IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CRM publication marker is retained';
  END IF;
  RETURN NEW;
END
$guard$;

CREATE TRIGGER "FinanceDocument_protect_publication"
BEFORE UPDATE OF state, "readyAt" OR DELETE ON public."FinanceDocument"
FOR EACH ROW EXECUTE FUNCTION public.pero_guard_unpublished_document();
CREATE TRIGGER "LogisticsDocument_protect_publication"
BEFORE UPDATE OF state, "readyAt" OR DELETE ON public."LogisticsDocument"
FOR EACH ROW EXECUTE FUNCTION public.pero_guard_unpublished_document();

CREATE FUNCTION public.pero_refresh_runtime_grants() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $grants$
DECLARE
  runtime_role name := ('pero_crm_runtime_' || left(md5(current_database()), 16))::name;
  target record;
  allowed_columns text;
  drafts oid[] := ARRAY['public."FinanceDocument"'::regclass::oid, 'public."LogisticsDocument"'::regclass::oid];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE contype = 'f' AND confrelid = ANY(drafts) AND confdeltype IN ('c','n','d')) THEN
    RAISE EXCEPTION 'CRM draft deletion must not cascade or modify another row';
  END IF;
  REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC;
  ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), runtime_role);
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', runtime_role);
  FOR target IN
    SELECT c.oid AS id, c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relname <> '_prisma_migrations'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', target.name, runtime_role);
    -- Table-level REVOKE leaves previous column ACLs intact.
    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
      INTO allowed_columns FROM pg_attribute a WHERE a.attrelid = target.id AND a.attnum > 0 AND NOT a.attisdropped;
    IF allowed_columns IS NOT NULL THEN
      EXECUTE format('REVOKE UPDATE (%s) ON TABLE public.%I FROM %I', allowed_columns, target.name, runtime_role);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO %I', target.name, runtime_role);
    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
      INTO allowed_columns FROM pg_attribute a
      WHERE a.attrelid = target.id AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
      AND NOT EXISTS (SELECT 1 FROM pg_constraint fk WHERE
        (fk.contype = 'p' AND fk.conrelid = target.id AND a.attnum = ANY(fk.conkey))
        OR (fk.contype = 'f' AND fk.confrelid = target.id AND fk.confupdtype IN ('c','n','d') AND a.attnum = ANY(fk.confkey)));
    IF allowed_columns IS NOT NULL AND target.name <> 'ChangeLog' THEN
      EXECUTE format('GRANT UPDATE (%s) ON TABLE public.%I TO %I', allowed_columns, target.name, runtime_role);
    END IF;
    IF target.id = ANY(drafts) THEN
      EXECUTE format('GRANT DELETE ON TABLE public.%I TO %I', target.name, runtime_role);
    END IF;
  END LOOP;
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', runtime_role);
END
$grants$;

CREATE FUNCTION public.pero_runtime_role_violations() RETURNS text[]
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $check$
WITH role_info AS (
  SELECT r.* FROM pg_roles r WHERE rolname = current_user
), expected AS (
  SELECT ('pero_crm_runtime_' || left(md5(current_database()), 16))::name AS role_name
), protected AS (
  SELECT c.oid AS id, c.relname, c.relowner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f','S')
), approved_drafts AS (
  SELECT unnest(ARRAY['public."FinanceDocument"'::regclass::oid, 'public."LogisticsDocument"'::regclass::oid]) AS id
)
SELECT array_remove(ARRAY[
  CASE WHEN session_user <> current_user OR NOT EXISTS (SELECT 1 FROM role_info WHERE rolcanlogin AND NOT
    (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls))
    THEN 'login' END,
  CASE WHEN NOT EXISTS (SELECT 1 FROM expected JOIN pg_roles r ON r.rolname = role_name
    WHERE NOT (r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
      AND pg_has_role(role_name, 'USAGE') AND NOT pg_has_role(role_name, 'SET'))
    OR EXISTS (SELECT 1 FROM pg_roles r, expected e WHERE r.rolname NOT IN (current_user,e.role_name) AND pg_has_role(r.oid,'MEMBER'))
    OR EXISTS (SELECT 1 FROM pg_auth_members m JOIN role_info r ON r.oid = m.member WHERE m.admin_option)
    THEN 'membership' END,
  CASE WHEN has_database_privilege(current_database(),'CREATE') OR has_parameter_privilege('session_replication_role','SET')
    OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg_temp_%' AND has_schema_privilege(n.oid,'CREATE'))
    OR EXISTS (SELECT 1 FROM protected p WHERE pg_has_role(p.relowner,'MEMBER'))
    OR EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'
      AND pg_has_role(t.typowner,'MEMBER'))
    THEN 'ownership_or_ddl' END,
  CASE WHEN EXISTS (SELECT 1 FROM protected p JOIN pg_class c ON c.oid = p.id WHERE c.relkind IN ('r','p','v','m','f')
    AND (has_table_privilege(p.id,'TRUNCATE,TRIGGER,REFERENCES,MAINTAIN')
      OR (c.relkind IN ('v','m','f') AND has_table_privilege(p.id,'INSERT,UPDATE'))
      OR (has_table_privilege(p.id,'DELETE') AND p.id NOT IN (SELECT id FROM approved_drafts))))
    THEN 'table_mutation' END,
  CASE WHEN EXISTS (SELECT 1 FROM protected p JOIN pg_class c ON c.oid = p.id
    WHERE c.relkind = 'S' AND has_sequence_privilege(p.id, 'UPDATE'))
    THEN 'sequence_mutation' END,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint fk JOIN protected p ON p.id = fk.confrelid, unnest(fk.confkey) AS a(num)
    WHERE fk.contype = 'f' AND fk.confupdtype IN ('c','n','d') AND has_column_privilege(p.id, a.num, 'UPDATE'))
    OR EXISTS (
      SELECT 1 FROM pg_constraint k JOIN protected p ON p.id = k.conrelid, unnest(k.conkey) AS a(num)
      WHERE k.contype = 'p' AND has_column_privilege(p.id, a.num, 'UPDATE'))
    OR EXISTS (SELECT 1 FROM pg_constraint fk WHERE fk.contype = 'f' AND fk.confrelid IN (SELECT id FROM approved_drafts)
      AND fk.confdeltype IN ('c','n','d'))
    THEN 'cascade' END,
  CASE WHEN EXISTS (SELECT 1 FROM approved_drafts d WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger t WHERE t.tgrelid = d.id AND t.tgfoid = 'public.pero_guard_unpublished_document()'::regprocedure
    AND t.tgenabled IN ('O','A') AND t.tgtype & 27 = 27))
    THEN 'publication_trigger' END,
  CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND (pg_has_role(p.proowner,'MEMBER') OR
      (p.prosecdef AND (has_function_privilege(p.oid,'EXECUTE') OR EXISTS (
        SELECT 1 FROM pg_trigger t JOIN protected c ON c.id=t.tgrelid WHERE t.tgfoid=p.oid AND t.tgenabled <> 'D')))))
    OR EXISTS (SELECT 1 FROM pg_foreign_server s WHERE has_server_privilege(s.oid,'USAGE'))
    THEN 'elevated_execution' END,
  CASE WHEN EXISTS (SELECT 1 FROM protected p JOIN pg_class c ON c.oid=p.id WHERE c.relkind IN ('r','p')
    AND p.relname <> '_prisma_migrations' AND NOT (has_table_privilege(p.id,'SELECT') AND has_table_privilege(p.id,'INSERT')))
    OR EXISTS (SELECT 1 FROM protected p WHERE p.relname = '_prisma_migrations' AND
      has_table_privilege(p.id,'INSERT,UPDATE,DELETE,TRUNCATE'))
    THEN 'schema_grants' END
], NULL);
$check$;

DO $setup$
DECLARE runtime_role name := ('pero_crm_runtime_' || left(md5(current_database()), 16))::name;
BEGIN
  REVOKE EXECUTE ON FUNCTION public.pero_refresh_runtime_grants() FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.pero_guard_unpublished_document() FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.pero_runtime_role_violations() FROM PUBLIC;
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.pero_runtime_role_violations() TO %I', runtime_role);
END
$setup$;

SELECT public.pero_refresh_runtime_grants();
