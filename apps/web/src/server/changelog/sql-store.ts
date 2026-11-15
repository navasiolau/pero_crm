import {Prisma} from '@prisma/client';
import type {JournalScope} from './contract';
import {journalEntityLabel} from './labels';
import {escapeJournalLike,JOURNAL_SYSTEM_ACTOR,type JournalQuery,type JournalListRow} from './query-contract';
import type {JournalReadStore,JournalOptionRecord} from './reader-core';
import {resolveJournalEntries,type JournalStoredEntry} from './resolver';

export type JournalReadDb=Pick<Prisma.TransactionClient,'$queryRaw'>;
const field=(path:string)=>Prisma.raw(`c.presentation #>> '{${path}}'`);
// Nullable/новая версия попадает в безопасный legacy resolver, а не исчезает из поиска.
export const JOURNAL_PREPARED_SQL=Prisma.sql`(c.presentation @> '{"version":1}'::jsonb
 AND c."searchText" IS NOT NULL
 AND c.presentation->>'kind' IN ('event','receipt','excluded')
 AND jsonb_typeof(c.presentation->'actor')='object'
 AND c.presentation #>> '{actor,type}' IN ('user','system')
 AND jsonb_typeof(c.presentation #> '{actor,id}')='string'
 AND jsonb_typeof(c.presentation #> '{actor,name}')='string'
 AND jsonb_typeof(c.presentation->'entity')='object'
 AND jsonb_typeof(c.presentation #> '{entity,type}')='string'
 AND jsonb_typeof(c.presentation #> '{entity,id}')='string'
 AND jsonb_typeof(c.presentation #> '{entity,label}')='string'
 AND (NOT (c.presentation->'entity' ? 'href') OR jsonb_typeof(c.presentation #> '{entity,href}')='string')
 AND jsonb_typeof(c.presentation->'action')='object'
 AND jsonb_typeof(c.presentation #> '{action,code}')='string'
 AND jsonb_typeof(c.presentation #> '{action,label}')='string'
 AND jsonb_typeof(c.presentation->'source')='object'
 AND jsonb_typeof(c.presentation #> '{source,code}')='string'
 AND jsonb_typeof(c.presentation #> '{source,label}')='string'
 AND (NOT (c.presentation ? 'reason') OR jsonb_typeof(c.presentation->'reason')='string')
 AND (NOT (c.presentation ? 'initiator') OR (jsonb_typeof(c.presentation->'initiator')='object'
  AND jsonb_typeof(c.presentation #> '{initiator,id}')='string' AND jsonb_typeof(c.presentation #> '{initiator,name}')='string'))
 AND jsonb_typeof(c.presentation->'changes')='array'
 AND jsonb_typeof(c.presentation->'contexts')='array'
 AND jsonb_typeof(c.presentation->'links')='array'
 AND jsonb_typeof(c.presentation->'technical')='object'
 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.presentation->'changes')='array' THEN c.presentation->'changes' ELSE '[]'::jsonb END) item
  WHERE NOT COALESCE(jsonb_typeof(item)='object' AND jsonb_typeof(item->'path')='string' AND jsonb_typeof(item->'label')='string'
   AND item ? 'before' AND item ? 'after' AND jsonb_typeof(item->'beforeKnown')='boolean' AND jsonb_typeof(item->'afterKnown')='boolean',FALSE))
 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.presentation->'contexts')='array' THEN c.presentation->'contexts' ELSE '[]'::jsonb END) item
  WHERE NOT COALESCE(jsonb_typeof(item)='object' AND item->>'kind' IN ('project','product') AND jsonb_typeof(item->'id')='string'
   AND jsonb_typeof(item->'label')='string' AND (NOT (item ? 'href') OR jsonb_typeof(item->'href')='string'),FALSE))
 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.presentation->'links')='array' THEN c.presentation->'links' ELSE '[]'::jsonb END) item
  WHERE NOT COALESCE(jsonb_typeof(item)='object' AND jsonb_typeof(item->'type')='string' AND jsonb_typeof(item->'id')='string'
   AND jsonb_typeof(item->'label')='string' AND (NOT (item ? 'href') OR jsonb_typeof(item->'href')='string'),FALSE)))`;

export function journalScopeSql(scope:JournalScope):Prisma.Sql{
 if(scope.kind==='global')return Prisma.sql`TRUE`;
 return Prisma.sql`(c.presentation->'contexts') @> ${JSON.stringify([{kind:scope.kind,id:scope.id}])}::jsonb`;
}
function dateSql(query:JournalQuery):Prisma.Sql[]{
 return [...(query.fromAt?[Prisma.sql`c."createdAt">=${query.fromAt}`]:[]),...(query.toBefore?[Prisma.sql`c."createdAt"<${query.toBefore}`]:[])];
}

export function journalPreparedWhere(query:JournalQuery):Prisma.Sql{
 const conditions=[JOURNAL_PREPARED_SQL,Prisma.sql`c.presentation->>'kind'='event'`,journalScopeSql(query.scope),...dateSql(query)];
 if(query.actorId)conditions.push(query.actorId===JOURNAL_SYSTEM_ACTOR?Prisma.sql`${field('actor,type')}='system'`:Prisma.sql`(${field('actor,type')}='user' AND ${field('actor,id')}=${query.actorId})`);
 if(query.entity)conditions.push(Prisma.sql`${field('entity,type')}=${query.entity}`);
 if(query.q){
  const pattern=`%${escapeJournalLike(query.q)}%`;
  conditions.push(Prisma.sql`(c."searchText" ILIKE ${pattern} ESCAPE '\\' OR c.id ILIKE ${pattern} ESCAPE '\\'
   OR to_char(c."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ILIKE ${pattern} ESCAPE '\\'
   OR to_char(c."createdAt"+interval '3 hours','DD.MM.YYYY HH24:MI:SS') ILIKE ${pattern} ESCAPE '\\')`);
 }
 return Prisma.join(conditions,' AND ');
}

function journalOrder(query:JournalQuery):Prisma.Sql{
 const primary=query.sort==='time'?Prisma.sql`c."createdAt"`:Prisma.sql`lower(${field(query.sort==='actor'?'actor,name':query.sort==='entity'?'entity,label':'action,label')}) COLLATE "C"`;
 return Prisma.sql`${primary} ${Prisma.raw(query.dir==='asc'?'ASC':'DESC')},c."createdAt" DESC,c.id COLLATE "C" DESC`;
}
const columns=Prisma.sql`c.id,c."actorType",c."actorId",c."actorName",c.entity,c."entityId",c.action,c.field,c."oldValue",c."newValue",c.source,c."createdAt",c.presentation,c."searchText"`;

/** Вызывается только внутри одного read-only RepeatableRead snapshot. */
export function createJournalReadStore(db:JournalReadDb):JournalReadStore{
 return {
  async pending(afterId,limit,query){
   const conditions=[Prisma.sql`NOT COALESCE(${JOURNAL_PREPARED_SQL},FALSE)`,...(afterId?[Prisma.sql`c.id>${afterId}`]:[]),...(query?dateSql(query):[])];
   const rows=await db.$queryRaw<JournalStoredEntry[]>(Prisma.sql`SELECT ${columns} FROM "ChangeLog" c WHERE ${Prisma.join(conditions,' AND ')} ORDER BY c.id ASC LIMIT ${limit}`);
   return resolveJournalEntries(db,rows);
  },
  async preparedCount(query){
   const [row]=await db.$queryRaw<{total:bigint}[]>(Prisma.sql`SELECT count(*) AS total FROM "ChangeLog" c WHERE ${journalPreparedWhere(query)}`);
   const total=Number(row.total);if(!Number.isSafeInteger(total))throw Error('JOURNAL_COUNT_OVERFLOW');return total;
  },
  async preparedRows(query,limit,offset=0){
   const rows=await db.$queryRaw<(Omit<JournalListRow,'createdAt'|'hasChanges'>&{createdAt:Date})[]>(Prisma.sql`
    SELECT c.id,c."createdAt",${field('actor,name')} AS "actorName",${field('entity,label')} AS "entityLabel",${field('action,label')} AS "actionLabel",
     jsonb_array_length(c.presentation->'changes') AS "changeCount"
    FROM "ChangeLog" c WHERE ${journalPreparedWhere(query)} ORDER BY ${journalOrder(query)} LIMIT ${limit} OFFSET ${offset}`);
   return rows.map(row=>({...row,createdAt:row.createdAt.toISOString(),hasChanges:row.changeCount>0}));
  },
  async find(id){
   const rows=await db.$queryRaw<JournalStoredEntry[]>(Prisma.sql`SELECT ${columns} FROM "ChangeLog" c WHERE c.id=${id}`);
   return (await resolveJournalEntries(db,rows))[0]??null;
  },
  async preparedOptions(scope){
   const rows=await db.$queryRaw<Omit<JournalOptionRecord,'entityLabel'>[]>(Prisma.sql`SELECT DISTINCT
    ${field('actor,type')} AS "actorType",${field('actor,id')} AS "actorId",${field('actor,name')} AS "actorName",${field('entity,type')} AS entity
    FROM "ChangeLog" c WHERE ${JOURNAL_PREPARED_SQL} AND c.presentation->>'kind'='event' AND ${journalScopeSql(scope)}`);
   return rows.map(row=>({...row,entityLabel:journalEntityLabel(row.entity)}));
  },
  async users(){return db.$queryRaw<{id:string;name:string}[]>`SELECT id,name FROM "User" ORDER BY name,id`;},
  entityLabel:journalEntityLabel,
 };
}
