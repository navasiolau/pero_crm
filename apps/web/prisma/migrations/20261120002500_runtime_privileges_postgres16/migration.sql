-- PostgreSQL 16 не знает MAINTAIN. Остальные проверки одинаковы в обеих версиях.
CREATE OR REPLACE FUNCTION public.pero_runtime_role_violations() RETURNS text[]
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $check$
WITH role_info AS (
  SELECT r.* FROM pg_roles r WHERE rolname = current_user
), expected AS (
  SELECT ('pero_crm_runtime_' || left(md5(current_database()), 16))::name AS role_name
), protected AS (
  SELECT c.oid AS id, c.relname, c.relowner, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f','S')
), table_relations AS MATERIALIZED (
  SELECT id, relname, relkind FROM protected WHERE relkind <> 'S'
), sequences AS MATERIALIZED (
  -- Планировщик вправе переставить условия AND. Разделяем OID до проверки ACL.
  SELECT id FROM protected WHERE relkind = 'S'
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
  CASE WHEN EXISTS (SELECT 1 FROM table_relations p WHERE (has_table_privilege(p.id,'TRUNCATE,TRIGGER,REFERENCES')
      OR CASE WHEN current_setting('server_version_num')::integer >= 170000
        THEN has_table_privilege(p.id,'MAINTAIN') ELSE false END
      OR (p.relkind IN ('v','m','f') AND has_table_privilege(p.id,'INSERT,UPDATE'))
      OR (has_table_privilege(p.id,'DELETE') AND p.id NOT IN (SELECT id FROM approved_drafts))))
    THEN 'table_mutation' END,
  CASE WHEN EXISTS (SELECT 1 FROM sequences s WHERE has_sequence_privilege(s.id, 'UPDATE'))
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
  CASE WHEN EXISTS (SELECT 1 FROM table_relations p WHERE p.relkind IN ('r','p')
    AND p.relname <> '_prisma_migrations' AND NOT (has_table_privilege(p.id,'SELECT') AND has_table_privilege(p.id,'INSERT')))
    OR EXISTS (SELECT 1 FROM table_relations p WHERE p.relname = '_prisma_migrations' AND
      has_table_privilege(p.id,'INSERT,UPDATE,DELETE,TRUNCATE'))
    THEN 'schema_grants' END
], NULL);
$check$;
