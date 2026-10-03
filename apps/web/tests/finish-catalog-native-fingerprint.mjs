import assert from 'node:assert/strict';
// Обнаруживаем и защищаем все actual public tables, включая модели иных веток,
// которых ещё нет в локальном сгенерированном Prisma client.
export async function fingerprintFinishCatalogDatabase(db){
 const names=await db.$queryRawUnsafe("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename");
 assert.ok(names.some(row=>row.tablename==='Finish'));assert.ok(names.some(row=>row.tablename==='_prisma_migrations'));
 const tables={};
 for(const {tablename} of names){assert.match(tablename,/^[A-Za-z_][A-Za-z0-9_]*$/);const value=tablename==='ApiToken'?"(to_jsonb(t)-'lastUsedAt')::text":'row_to_json(t)::text';const[row]=await db.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(${value},'' ORDER BY ${value}),'')) AS hash FROM "${tablename}" t`);tables[tablename]=row;}
 const definitions={
  columns:"SELECT table_name,column_name,udt_name,is_nullable,column_default,ordinal_position FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
  constraints:"SELECT c.relname AS table_name,k.conname,pg_get_constraintdef(k.oid,true) AS definition FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,k.conname",
  indexes:"SELECT tablename,indexname,indexdef FROM pg_catalog.pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname",
  enums:"SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace JOIN pg_catalog.pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder",
  triggers:"SELECT c.relname AS table_name,t.tgname,t.tgenabled,t.tgisinternal,pg_get_triggerdef(t.oid,true) AS definition FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,t.tgname",
  routines:"SELECT p.proname,p.prokind,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY p.proname,arguments,p.prokind",
  views:"SELECT c.relname,c.relkind,c.relispopulated,c.reloptions,pg_get_viewdef(c.oid,true) AS definition FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m') ORDER BY c.relname",
  sequences:"SELECT c.relname,format_type(s.seqtypid,NULL) AS data_type,s.seqstart::text,s.seqincrement::text,s.seqmax::text,s.seqmin::text,s.seqcache::text,s.seqcycle FROM pg_catalog.pg_sequence s JOIN pg_catalog.pg_class c ON c.oid=s.seqrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname",
 };
 const schema={};
 for(const[key,query]of Object.entries(definitions)){const[row]=await db.$queryRawUnsafe(`SELECT md5(COALESCE(string_agg(row_to_json(s)::text,'' ORDER BY row_to_json(s)::text),'')) AS hash FROM (${query}) s`);schema[key]=row.hash;}
 // Данные materialized views защищаем отдельно от определения и состояния populated.
 const materializedViews={};
 const views=await db.$queryRawUnsafe("SELECT matviewname,ispopulated FROM pg_catalog.pg_matviews WHERE schemaname='public' ORDER BY matviewname");
 for(const {matviewname,ispopulated} of views){assert.match(matviewname,/^[A-Za-z_][A-Za-z0-9_]*$/);if(!ispopulated){materializedViews[matviewname]={populated:false};continue;}const[row]=await db.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(row_to_json(t)::text,'' ORDER BY row_to_json(t)::text),'')) AS hash FROM "${matviewname}" t`);materializedViews[matviewname]={populated:true,...row};}
 return{tables,schema,materializedViews};
}
