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
 };
 const schema={};
 for(const[key,query]of Object.entries(definitions)){const[row]=await db.$queryRawUnsafe(`SELECT md5(COALESCE(string_agg(row_to_json(s)::text,'' ORDER BY row_to_json(s)::text),'')) AS hash FROM (${query}) s`);schema[key]=row.hash;}
 return{tables,schema};
}
