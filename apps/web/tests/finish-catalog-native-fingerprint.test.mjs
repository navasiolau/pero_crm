import assert from 'node:assert/strict';
import test from 'node:test';
import {fingerprintFinishCatalogDatabase} from './finish-catalog-native-fingerprint.mjs';
const groups={columns:'information_schema.columns',constraints:'pg_catalog.pg_constraint',indexes:'pg_catalog.pg_indexes',enums:'pg_catalog.pg_enum',triggers:'pg_catalog.pg_trigger',routines:'pg_catalog.pg_proc',views:'pg_get_viewdef',sequences:'pg_catalog.pg_sequence'};
function fixture(){
 let calendar='original-calendar',materialized='original-view',populated=true;
 const schemas=Object.fromEntries(Object.keys(groups).map(key=>[key,'original-'+key]));
 const queries=[];
 const db={$queryRawUnsafe:async sql=>{
  queries.push(sql);
  if(sql.includes('SELECT tablename FROM'))return['ApiToken','CalendarEntry','Finish','_prisma_migrations'].map(tablename=>({tablename}));
  if(sql.includes('SELECT matviewname,ispopulated'))return[{matviewname:'PopulatedSummary',ispopulated:populated},{matviewname:'UnpopulatedSummary',ispopulated:false}];
  if(sql.includes('FROM "CalendarEntry"'))return[{count:'1',hash:calendar}];
  if(sql.includes('FROM "PopulatedSummary"'))return[{count:'2',hash:materialized}];
  if(sql.includes('FROM "UnpopulatedSummary"'))throw new Error('UNPOPULATED_VIEW_MUST_NOT_BE_READ');
  if(sql.includes('AS hash FROM (')){
   const key=Object.keys(groups).find(key=>sql.includes(groups[key]));
   assert.ok(key,'Unexpected schema query');return[{hash:schemas[key]}];
  }
  return[{count:'0',hash:'unchanged'}];
 }};
 return{db,queries,setCalendar(value){calendar=value},setSchema(key,value){schemas[key]=value},setMaterialized(value){materialized=value},setPopulated(value){populated=value}};
}
test('native profile protects discovered tables and every schema definition group independently',async()=>{
 const f=fixture(),before=await fingerprintFinishCatalogDatabase(f.db);
 assert.ok('CalendarEntry' in before.tables);
 assert.deepEqual(Object.keys(before.schema).sort(),Object.keys(groups).sort());
 f.setCalendar('changed');assert.notDeepEqual(await fingerprintFinishCatalogDatabase(f.db),before);f.setCalendar('original-calendar');
 for(const key of Object.keys(groups)){
  f.setSchema(key,'changed-ddl');const after=await fingerprintFinishCatalogDatabase(f.db);
  assert.notEqual(after.schema[key],before.schema[key]);assert.notDeepEqual(after,before);
  f.setSchema(key,'original-'+key);assert.deepEqual(await fingerprintFinishCatalogDatabase(f.db),before);
 }
});
test('only ApiToken lastUsedAt is excluded; all other actual public table rows are fully protected',async()=>{
 const f=fixture();await fingerprintFinishCatalogDatabase(f.db);
 const exceptions=f.queries.filter(sql=>sql.includes("-'lastUsedAt'"));assert.equal(exceptions.length,1);assert.match(exceptions[0],/FROM "ApiToken"/);
 const calendar=f.queries.find(sql=>sql.includes('FROM "CalendarEntry"'));assert.ok(calendar?.includes('row_to_json(t)::text'));
});
test('populated materialized view data changes are detected and unpopulated views are never queried',async()=>{
 const f=fixture(),before=await fingerprintFinishCatalogDatabase(f.db);
 assert.deepEqual(before.materializedViews.PopulatedSummary,{populated:true,count:'2',hash:'original-view'});
 assert.deepEqual(before.materializedViews.UnpopulatedSummary,{populated:false});
 f.setMaterialized('changed-view');assert.notDeepEqual(await fingerprintFinishCatalogDatabase(f.db),before);
 f.setMaterialized('original-view');assert.deepEqual(await fingerprintFinishCatalogDatabase(f.db),before);
 f.setPopulated(false);const after=await fingerprintFinishCatalogDatabase(f.db);
 assert.deepEqual(after.materializedViews.PopulatedSummary,{populated:false});assert.notDeepEqual(after,before);
 assert.ok(!f.queries.some(sql=>sql.includes('FROM "UnpopulatedSummary"')));
});
