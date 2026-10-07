import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {PrismaClient} from '@prisma/client';
const mode=process.argv[2],file=process.argv[3],url=new URL(process.env.DATABASE_URL??'');
assert.ok(['before','after'].includes(mode));assert.ok(file);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));assert.equal(url.port,'5433');assert.equal(url.pathname,'/pero_crm');
const db=new PrismaClient();
try{
 const current=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');const tables=await tx.$queryRaw`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;const hashes={};
  for(const{name}of tables){assert.match(name,/^[A-Za-z_][A-Za-z0-9_]*$/);if(name==='_prisma_migrations')continue;const[row]=await tx.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(row_to_json(t)::text,'' ORDER BY row_to_json(t)::text),'')) AS hash FROM "${name}" t`);hashes[name]=row;}
  const statuses=await tx.product.groupBy({by:['status'],_count:{_all:true},orderBy:{status:'asc'}});
  const migrations=await tx.$queryRaw`SELECT migration_name AS name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  const[d]=await tx.$queryRaw`SELECT column_default AS value FROM information_schema.columns WHERE table_schema='public' AND table_name='Product' AND column_name='status'`;
  return{hashes,statuses,migrations,default:d.value};
 },{isolationLevel:'RepeatableRead',timeout:120000});
 if(mode==='before'){assert.equal(current.default,"'DESIGN'::\"ProductStatus\"");await writeFile(file,JSON.stringify(current));}
 else{const before=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(current.hashes,before.hashes);assert.deepEqual(current.statuses,before.statuses);assert.equal(current.default,"'PREPARATION'::\"ProductStatus\"");assert.equal(current.migrations.length,before.migrations.length+2);assert.deepEqual(current.migrations.slice(0,before.migrations.length),before.migrations);}
 console.log(JSON.stringify({target:'local',mode,tables:Object.keys(current.hashes).length,default:current.default,statusesUnchanged:mode==='after',allOriginalRowsUnchanged:mode==='after'}));
}finally{await db.$disconnect();}
