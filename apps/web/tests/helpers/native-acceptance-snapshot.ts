import assert from 'node:assert/strict';
import type {PrismaClient} from '@prisma/client';
import {createHash} from 'node:crypto';
type SnapshotDb=Pick<PrismaClient,'$queryRawUnsafe'>;
export type OwnedRowKeys=Record<string,{column:string;ids:string[]}>;
const identifier=(value:string)=>{assert.match(value,/^[A-Za-z_][A-Za-z0-9_]*$/,'SCHEMA_IDENTIFIER_INVALID');return '"'+value+'"';};
const selection=(alias:string,column:string)=>alias+'.'+identifier(column)+'::text = ANY(ARRAY(SELECT jsonb_array_elements_text($1::jsonb)))';
function checkedOwned(owned:OwnedRowKeys) {
 for(const [table,value] of Object.entries(owned)) {
  identifier(table);identifier(value.column);
  assert.ok(value.ids.length>0&&new Set(value.ids).size===value.ids.length&&value.ids.every(id=>typeof id==='string'&&id.length>0&&id.length<256),'EXACT_OWNED_KEYS_REQUIRED');
 }
}
export function nativeOwnedIds(tables:Record<string,readonly string[]>):OwnedRowKeys {
 const owned:OwnedRowKeys={};
 for(const [table,ids] of Object.entries(tables)) {
  if(ids.length)owned[table]={column:'id',ids:[...ids]};
 }
 checkedOwned(owned);
 return owned;
}
// Fingerprints existing данных: наружу не выходят строки/Decimal values и dump не создаётся.
export async function nativeSnapshot(db:SnapshotDb,owned:OwnedRowKeys={}) {
 checkedOwned(owned);
 const tables=await db.$queryRawUnsafe<{tablename:string}[]>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
 assert.equal(new Set(tables.map(row=>row.tablename)).size,tables.length,'SNAPSHOT_TABLE_LIST_DUPLICATE');
 assert.ok(Object.keys(owned).every(table=>tables.some(row=>row.tablename===table)),'OWNED_TABLE_MISSING');
 const branches=tables.map(({tablename})=>{
  const table=identifier(tablename),exclusion=owned[tablename];
  const filter=exclusion?' WHERE NOT (t.'+identifier(exclusion.column)+'::text = ANY(ARRAY(SELECT jsonb_array_elements_text((SELECT keys FROM owned)->\''+tablename+'\'->\'ids\'))))':'';
  return 'SELECT \''+tablename+'\'::text AS tablename,count(*)::text AS count,md5(COALESCE(string_agg(row_to_json(t)::text,\'\' ORDER BY row_to_json(t)::text),\'\')) AS hash FROM public.'+table+' t'+filter;
 });
 const fingerprints=await db.$queryRawUnsafe<{tablename:string;count:string;hash:string}[]>('WITH owned AS (SELECT $1::jsonb AS keys) '+(branches.join(' UNION ALL ')||'SELECT NULL::text AS tablename,NULL::text AS count,NULL::text AS hash WHERE false'),JSON.stringify(owned));
 const byTable=new Map(fingerprints.map(row=>[row.tablename,row]));
 assert.equal(fingerprints.length,tables.length,'SNAPSHOT_TABLE_RESULT_MISSING');
 assert.equal(byTable.size,tables.length,'SNAPSHOT_TABLE_RESULT_DUPLICATE');
 const rows:Record<string,unknown>={};
 for(const {tablename} of tables) {
  const row=byTable.get(tablename);assert.ok(row,'SNAPSHOT_TABLE_RESULT_MISSING');
  assert.match(row.count,/^\d+$/);assert.match(row.hash,/^[a-f0-9]{32}$/);
  rows[tablename]=[{count:row.count,hash:row.hash}];
 }
 const catalog=await db.$queryRawUnsafe<{constraints:string;functions:string;triggers:string;indexes:string}[]>(`SELECT
  (SELECT md5(COALESCE(string_agg(t.relname::text||c.conname::text||c.convalidated::text||pg_get_constraintdef(c.oid),'' ORDER BY t.relname,c.conname),'')) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public') AS constraints,
  (SELECT md5(COALESCE(string_agg(pg_get_functiondef(p.oid),'' ORDER BY p.proname,p.oid),'')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f') AS functions,
  (SELECT md5(COALESCE(string_agg(t.relname::text||g.tgname::text||g.tgenabled::text||g.tgtype::text||pg_get_triggerdef(g.oid),'' ORDER BY t.relname,g.tgname),'')) FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND NOT g.tgisinternal) AS triggers,
  (SELECT md5(COALESCE(string_agg(t.relname::text||i.indisvalid::text||i.indisready::text||pg_get_indexdef(i.indexrelid),'' ORDER BY t.relname,i.indexrelid),'')) FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public') AS indexes`);
 assert.equal(catalog.length,1,'SNAPSHOT_CATALOG_RESULT_REQUIRED');
 for(const hash of Object.values(catalog[0]))assert.match(hash,/^[a-f0-9]{32}$/);
 const {constraints:constraintHash,functions:functionHash,triggers:triggerHash,indexes:indexHash}=catalog[0];
 const constraints=[{hash:constraintHash}],functions=[{hash:functionHash}],triggers=[{hash:triggerHash}],indexes=[{hash:indexHash}];
 const snapshot={rows,constraints,functions,triggers,indexes};
 return {snapshot,digest:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
}
// FOR UPDATE exact parent keys conflicts with new incoming FK key-share locks.
export async function lockExactOwnedRows(db:SnapshotDb,owned:OwnedRowKeys) {
 checkedOwned(owned);
 const keys=await db.$queryRawUnsafe<{table:string;columns:string[]}[]>("SELECT t.relname AS \"table\",ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY AS k(num,position) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.num ORDER BY k.position) AS columns FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND c.contype='p'");
 for(const [table,value] of Object.entries(owned).sort(([a],[b])=>a.localeCompare(b))) {
  assert.deepEqual(keys.find(key=>key.table===table)?.columns,[value.column],'EXACT_SINGLE_PRIMARY_KEY_REQUIRED');
  const locked=await db.$queryRawUnsafe<{key:string}[]>('SELECT t.'+identifier(value.column)+'::text AS key FROM public.'+identifier(table)+' t WHERE '+selection('t',value.column)+' ORDER BY key FOR UPDATE',JSON.stringify(value.ids));
  assert.deepEqual(locked.map(row=>row.key).sort(),[...value.ids].sort(),'OWNED_ROW_MISSING');
 }
}
type ForeignKey={schema:string;table:string;parent:string;columns:string[];references:string[]};
export async function assertNoForeignReferences(db:SnapshotDb,owned:OwnedRowKeys) {
 checkedOwned(owned);
 const references=await db.$queryRawUnsafe<ForeignKey[]>("SELECT cn.nspname AS \"schema\",child.relname AS \"table\",parent.relname AS parent,ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY AS k(num,position) JOIN pg_attribute a ON a.attrelid=child.oid AND a.attnum=k.num ORDER BY k.position) AS columns,ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY AS k(num,position) JOIN pg_attribute a ON a.attrelid=parent.oid AND a.attnum=k.num ORDER BY k.position) AS \"references\" FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_namespace cn ON cn.oid=child.relnamespace JOIN pg_class parent ON parent.oid=c.confrelid JOIN pg_namespace pn ON pn.oid=parent.relnamespace WHERE c.contype='f' AND pn.nspname='public' ORDER BY cn.nspname,child.relname,c.conname");
 for(const reference of references) {
  const parent=owned[reference.parent];if(!parent)continue;
  assert.equal(reference.schema,'public','FOREIGN_SCHEMA_REFERENCE_REVIEW_REQUIRED');
  assert.ok(reference.columns.length>0&&reference.columns.length===reference.references.length,'FOREIGN_KEY_SHAPE_INVALID');
  const join=reference.columns.map((column,index)=>'c.'+identifier(column)+'=p.'+identifier(reference.references[index])).join(' AND ');
  const child=owned[reference.table],exclude=child?' AND NOT (c.'+identifier(child.column)+'::text = ANY(ARRAY(SELECT jsonb_array_elements_text($2::jsonb))))':'';
  const rows=await db.$queryRawUnsafe<{count:string}[]>('SELECT count(*)::text AS count FROM public.'+identifier(reference.table)+' c JOIN public.'+identifier(reference.parent)+' p ON '+join+' WHERE '+selection('p',parent.column)+exclude,JSON.stringify(parent.ids),...(child?[JSON.stringify(child.ids)]:[]));
  assert.equal(rows[0]?.count,'0','FOREIGN_REFERENCE_HOLD_BEFORE_DELETE');
 }
}
// Даже unexpected assertion обязана завершиться проверкой original baseline.
export async function verifiedRollback<T>(run:()=>Promise<T>,verify:()=>Promise<unknown>):Promise<T> {
 let failure:unknown,result:T|undefined,hasFailure=false;
 try {result=await run();}catch(error){failure=error;hasFailure=true;}
 try {await verify();}catch(error){if(hasFailure)throw new AggregateError([failure,error],'ROLLBACK_PRESERVATION_HOLD');throw error;}
 if(hasFailure)throw failure;
 return result as T;
}
