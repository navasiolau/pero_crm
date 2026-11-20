CREATE OR REPLACE FUNCTION public.pero_refresh_runtime_grants() RETURNS void
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
  -- Четыре неизменяемых SECURITY INVOKER-предиката проверяют JSON и ключи объектов в CHECK таблиц КП.
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.kp_json_object_array(jsonb),
    public.kp_valid_state(jsonb), public.kp_valid_storage_binding(jsonb),
    public.kp_valid_object_key(text) TO %I', runtime_role);
END
$grants$;

SELECT public.pero_refresh_runtime_grants();
