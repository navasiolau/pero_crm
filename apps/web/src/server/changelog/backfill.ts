import {Prisma} from '@prisma/client';
import {assertJournalBackfillIdentity,type JournalBackfillTarget,type JournalDatabaseIdentity} from './backfill-target';
import {resolveJournalEntries,type JournalStoredEntry} from './resolver';
import {buildJournalSearchText} from './presentation';

export type JournalBackfillBatchInput={target:JournalBackfillTarget;mode:'check'|'apply';batchSize:number;afterId?:string|null;onlyIds?:readonly string[]};
export type JournalBackfillBatchResult={scanned:number;updated:number;nextAfterId:string|null;remaining:number;rawVerified:number};
type Database=Pick<Prisma.TransactionClient,'$queryRaw'|'$executeRaw'>;
const pending=Prisma.sql`(c.presentation IS NULL OR jsonb_typeof(c.presentation)='null' OR c.presentation @> '{"version":1}'::jsonb)
 AND (c."searchText" IS NULL OR c.presentation IS NULL OR c.presentation #>> '{technical,referenceResolutionVersion}' IS DISTINCT FROM '1')`;

export async function readJournalDatabaseIdentity(tx:Pick<Database,'$queryRaw'>):Promise<JournalDatabaseIdentity>{
 const [identity]=await tx.$queryRaw<JournalDatabaseIdentity[]>`SELECT current_database() AS database,current_schema() AS schema,current_user AS role,system_identifier::text AS "systemIdentifier" FROM pg_control_system()`;
 if(!identity)throw Error('JOURNAL_BACKFILL_DATABASE_STOP');return identity;
}

/** Транзакцию открывает reviewed runner. Меняем только две дополнительные колонки. */
export async function backfillJournalBatch(tx:Database,input:JournalBackfillBatchInput):Promise<JournalBackfillBatchResult>{
 assertJournalBackfillIdentity(input.target,await readJournalDatabaseIdentity(tx));
 if(!['check','apply'].includes(input.mode)||!Number.isInteger(input.batchSize)||input.batchSize<1||input.batchSize>500||
  input.onlyIds&&(input.onlyIds.length===0||input.onlyIds.length>1000))throw Error('JOURNAL_BACKFILL_INPUT_STOP');
 const restriction=input.onlyIds?Prisma.sql`c.id IN (${Prisma.join([...input.onlyIds])})`:Prisma.sql`TRUE`;
 const rows=await tx.$queryRaw<(JournalStoredEntry&{rawDigest:string})[]>(Prisma.sql`SELECT c.*,md5((to_jsonb(c)-'presentation'-'searchText')::text) AS "rawDigest"
  FROM "ChangeLog" c WHERE ${pending} AND ${restriction} ${input.afterId?Prisma.sql`AND c.id>${input.afterId}`:Prisma.empty}
  ORDER BY c.id LIMIT ${input.batchSize} ${input.mode==='apply'?Prisma.sql`FOR UPDATE`:Prisma.empty}`);
 const resolved=await resolveJournalEntries(tx,rows,true);
 let updated=0,rawVerified=0;
 for(let index=0;index<rows.length;index++){
  const raw=rows[index],entry=resolved[index];
  const presentation={...entry.presentation,technical:{...entry.presentation.technical,referenceResolutionVersion:1}};
  const searchText=buildJournalSearchText(raw,presentation);
  if(input.mode==='check')continue;
  const changed=await tx.$queryRaw<{rawDigest:string}[]>(Prisma.sql`UPDATE "ChangeLog" c SET presentation=${JSON.stringify(presentation)}::jsonb,"searchText"=${searchText}
   WHERE c.id=${raw.id} AND c.presentation IS NOT DISTINCT FROM ${raw.presentation===null?null:JSON.stringify(raw.presentation)}::jsonb
    AND c."searchText" IS NOT DISTINCT FROM ${raw.searchText}
   RETURNING md5((to_jsonb(c)-'presentation'-'searchText')::text) AS "rawDigest"`);
  if(changed.length!==1)throw Error('JOURNAL_BACKFILL_CONFLICT_STOP');
  if(changed[0].rawDigest!==raw.rawDigest)throw Error('JOURNAL_BACKFILL_RAW_CHANGED_STOP');
  updated++;rawVerified++;
 }
 const [remaining]=await tx.$queryRaw<{total:bigint}[]>(Prisma.sql`SELECT count(*) AS total FROM "ChangeLog" c WHERE ${pending} AND ${restriction}`);
 return {scanned:rows.length,updated,nextAfterId:rows.at(-1)?.id??input.afterId??null,remaining:Number(remaining.total),rawVerified};
}
