import {Prisma} from '@prisma/client';
import type {JournalScope} from './contract';
import {journalEntityLabel} from './labels';
import {escapeJournalLike,JOURNAL_SYSTEM_ACTOR,normalizeJournalQuery,type JournalQuery,type JournalListRow} from './query-contract';
import type {JournalReadStore,JournalOptionRecord} from './reader-core';
import {resolveJournalEntries,type JournalStoredEntry} from './resolver';

export type JournalReadDb=Pick<Prisma.TransactionClient,'$queryRaw'>;
const field=(path:string)=>Prisma.raw(`c.presentation #>> '{${path}}'`);
// Один JSONPath вызов распаковывает TOAST один раз; проверка остаётся полной и fail-closed.
const textField=(path:string)=>`exists(${path}) && ${path}.type() == "string"`;
const optionalText=(path:string)=>`(!exists(${path}) || ${path}.type() == "string")`;
const reference=(item:string)=>`${item}.type() == "object" && ${textField(item+'.type')} && ${textField(item+'.id')} && ${textField(item+'.label')} && ${optionalText(item+'.href')}`;
const validContext=`@.type() == "object" && ${textField('@.kind')} && (@.kind == "project" || @.kind == "product") && ${textField('@.id')} && ${textField('@.label')} && ${optionalText('@.href')}`;
const validChange=`@.type() == "object" && ${textField('@.path')} && ${textField('@.label')} && exists(@.before) && exists(@.after) && exists(@.beforeKnown) && @.beforeKnown.type() == "boolean" && exists(@.afterKnown) && @.afterKnown.type() == "boolean"`;
const allItems=(key:string,condition:string)=>`@.${key}.type() == "array" && !exists(@.${key}[*] ? (!(${condition})))`;
export const JOURNAL_PRESENTATION_JSONPATH=`lax $ ? (
 @.type() == "object" && @.version.type() == "number" && @.version == 1 && ${textField('@.kind')} && (@.kind == "event" || @.kind == "receipt" || @.kind == "excluded")
 && @.actor.type() == "object" && ${textField('@.actor.type')} && (@.actor.type == "user" || @.actor.type == "system") && ${textField('@.actor.id')} && ${textField('@.actor.name')}
 && ${reference('@.entity')} && @.action.type() == "object" && ${textField('@.action.code')} && ${textField('@.action.label')}
 && @.source.type() == "object" && ${textField('@.source.code')} && ${textField('@.source.label')}
 && ${optionalText('@.reason')} && (!exists(@.initiator) || (@.initiator.type() == "object" && ${textField('@.initiator.id')} && ${textField('@.initiator.name')}))
 && @.technical.type() == "object" && ${allItems('contexts',validContext)} && ${allItems('changes',validChange)} && ${allItems('links',reference('@'))}
)`;
const READY_KIND_PATH=`${JOURNAL_PRESENTATION_JSONPATH}.kind`;
const readyKind=Prisma.sql`CASE WHEN c."searchText" IS NULL THEN NULL ELSE jsonb_path_query_first(c.presentation,${READY_KIND_PATH}::jsonpath,'{}'::jsonb,true) #>> '{}' END`;
export const JOURNAL_PREPARED_SQL=Prisma.sql`(${readyKind} IS NOT NULL)`;

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
 if(query.q)conditions.push(searchSql(query.q,Prisma.sql`c.id`));
 return Prisma.join(conditions,' AND ');
}
function searchSql(query:string,id:Prisma.Sql):Prisma.Sql{
 return Prisma.sql`${id} IN (${searchMatchesSql(query)})`;
}
function searchMatchesSql(query:string):Prisma.Sql{
 const pattern=`%${escapeJournalLike(query)}%`;
 // OR с inline id/date не должен заставлять распаковывать все searchText вместо GIN.
 return Prisma.sql`
  SELECT s.id FROM "ChangeLog" s WHERE s."searchText" ILIKE ${pattern} ESCAPE '\\'
  UNION SELECT s.id FROM "ChangeLog" s WHERE s.id ILIKE ${pattern} ESCAPE '\\'
   OR to_char(s."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ILIKE ${pattern} ESCAPE '\\'
   OR to_char(s."createdAt"+interval '3 hours','DD.MM.YYYY HH24:MI:SS') ILIKE ${pattern} ESCAPE '\\'`;
}

const rawColumns=Prisma.sql`c.id,c."actorType",c."actorId",c."actorName",c.entity,c."entityId",c.action,c.field,c."oldValue",c."newValue",c.source,c."createdAt",c.presentation,c."searchText",c."reversesId"`;
type PageSnapshot={total:bigint;offset:bigint;entries:JournalListRow[];pendingIds:string[]};
function classification(query:JournalQuery){
 const dates=dateSql(query);
 return Prisma.sql`classified AS MATERIALIZED (SELECT c.id,c."createdAt",${readyKind} AS kind FROM "ChangeLog" c ${dates.length?Prisma.sql`WHERE ${Prisma.join(dates,' AND ')}`:Prisma.empty})`;
}

/** Одна валидация всей истории и только одна SQL-страница; большие payload не материализуются. */
export function journalPageSql(query:JournalQuery):Prisma.Sql{
 const needsPresentation=query.scope.kind!=='global'||!!query.actorId||!!query.entity;
 const match=[Prisma.sql`r.kind='event'`];
 if(query.scope.kind!=='global')match.push(journalScopeSql(query.scope));
 if(query.actorId)match.push(query.actorId===JOURNAL_SYSTEM_ACTOR?Prisma.sql`${field('actor,type')}='system'`:Prisma.sql`(${field('actor,type')}='user' AND ${field('actor,id')}=${query.actorId})`);
 if(query.entity)match.push(Prisma.sql`${field('entity,type')}=${query.entity}`);
 const sortValue=query.sort==='time'?Prisma.empty:Prisma.sql`,lower(${field(query.sort==='actor'?'actor,name':query.sort==='entity'?'entity,label':'action,label')}) COLLATE "C" AS sort_value`;
 const order=Prisma.sql`${query.sort==='time'?Prisma.sql`m."createdAt"`:Prisma.sql`m.sort_value COLLATE "C"`} ${Prisma.raw(query.dir==='asc'?'ASC':'DESC')},m."createdAt" DESC,m.id COLLATE "C" DESC`;
 return Prisma.sql`WITH ${classification(query)},
  eligible AS MATERIALIZED (SELECT r.id FROM classified r
   ${needsPresentation?Prisma.sql`JOIN "ChangeLog" c ON c.id=r.id`:Prisma.empty} WHERE ${Prisma.join(match,' AND ')}),
  matching_ids AS MATERIALIZED (SELECT id FROM eligible ${query.q?Prisma.sql`INTERSECT (${searchMatchesSql(query.q)})`:Prisma.empty}),
  matched AS MATERIALIZED (SELECT c.id,c."createdAt"${sortValue} FROM matching_ids m JOIN "ChangeLog" c ON c.id=m.id),
  totals AS (SELECT count(*) AS total FROM matched),
  bounds AS (SELECT total,((LEAST(${query.page}::bigint,GREATEST(1,ceil(total::numeric/${query.pageSize}))) - 1)*${query.pageSize})::bigint AS page_offset FROM totals),
  page AS MATERIALIZED (SELECT m.id,row_number() OVER(ORDER BY ${order}) AS ordinal FROM matched m ORDER BY ${order}
   LIMIT ${query.pageSize} OFFSET (SELECT page_offset FROM bounds))
  SELECT bounds.total,bounds.page_offset AS "offset",
   COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'createdAt',to_char(c."createdAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'actorName',j.actor->>'name','entityLabel',j.entity->>'label','actionLabel',j.action->>'label',
    'changeCount',jsonb_array_length(j.changes),'hasChanges',jsonb_array_length(j.changes)>0) ORDER BY page.ordinal)
    FROM page JOIN "ChangeLog" c ON c.id=page.id CROSS JOIN LATERAL jsonb_to_record(CASE WHEN page.id=c.id THEN c.presentation ELSE '{}'::jsonb END) AS j(actor jsonb,entity jsonb,action jsonb,changes jsonb)),'[]'::jsonb) AS entries,
   COALESCE((SELECT jsonb_agg(r.id ORDER BY r.id COLLATE "C") FROM classified r WHERE r.kind IS NULL),'[]'::jsonb) AS "pendingIds"
  FROM bounds`;
}

function journalOrder(query:JournalQuery):Prisma.Sql{
 const primary=query.sort==='time'?Prisma.sql`c."createdAt"`:Prisma.sql`lower(${field(query.sort==='actor'?'actor,name':query.sort==='entity'?'entity,label':'action,label')}) COLLATE "C"`;
 return Prisma.sql`${primary} ${Prisma.raw(query.dir==='asc'?'ASC':'DESC')},c."createdAt" DESC,c.id COLLATE "C" DESC`;
}

/** Вызывается только внутри одного read-only RepeatableRead snapshot. */
export function createJournalReadStore(db:JournalReadDb):JournalReadStore{
 let pageSnapshot:PageSnapshot|null=null,pendingIds:string[]|null=null,pageKey='';
 const queryKey=(query:JournalQuery)=>JSON.stringify([query.scope,query.q,query.actorId,query.entity,query.fromAt,query.toBefore,query.page,query.pageSize,query.sort,query.dir]);
 async function prepare(query:JournalQuery){
  const key=queryKey(query);
  if(!pageSnapshot||pageKey!==key){[pageSnapshot]=await db.$queryRaw<PageSnapshot[]>(journalPageSql(query));pendingIds=pageSnapshot.pendingIds;pageKey=key;}
  return pageSnapshot;
 }
 return {
  async pending(afterId,limit,query){
   if(query)await prepare(query);
   if(pendingIds){
    const index=afterId===null?0:pendingIds.indexOf(afterId)+1;if(afterId!==null&&index===0)throw Error('JOURNAL_CURSOR_UNKNOWN');
    const ids=pendingIds.slice(index,index+limit);if(!ids.length)return [];
    const rows=await db.$queryRaw<JournalStoredEntry[]>(Prisma.sql`SELECT ${rawColumns} FROM "ChangeLog" c WHERE c.id IN (${Prisma.join(ids)}) ORDER BY c.id COLLATE "C" ASC`);
    return resolveJournalEntries(db,rows);
   }
   const conditions=[Prisma.sql`NOT COALESCE(${JOURNAL_PREPARED_SQL},FALSE)`,...(afterId?[Prisma.sql`c.id>${afterId}`]:[]),...(query?dateSql(query):[])];
   const rows=await db.$queryRaw<JournalStoredEntry[]>(Prisma.sql`SELECT ${rawColumns} FROM "ChangeLog" c WHERE ${Prisma.join(conditions,' AND ')} ORDER BY c.id ASC LIMIT ${limit}`);
   return resolveJournalEntries(db,rows);
  },
  async preparedCount(query){
   if(pageSnapshot&&pageKey===queryKey(query)){const total=Number(pageSnapshot.total);if(!Number.isSafeInteger(total))throw Error('JOURNAL_COUNT_OVERFLOW');return total;}
   const [row]=await db.$queryRaw<{total:bigint}[]>(Prisma.sql`SELECT count(*) AS total FROM "ChangeLog" c WHERE ${journalPreparedWhere(query)}`);
   const total=Number(row.total);if(!Number.isSafeInteger(total))throw Error('JOURNAL_COUNT_OVERFLOW');return total;
  },
  async preparedRows(query,limit,offset=0){
   if(pageSnapshot&&pageKey===queryKey(query)&&offset===Number(pageSnapshot.offset)&&limit===query.pageSize)return pageSnapshot.entries;
   const rows=await db.$queryRaw<(Omit<JournalListRow,'createdAt'|'hasChanges'>&{createdAt:Date})[]>(Prisma.sql`
    SELECT c.id,c."createdAt",${field('actor,name')} AS "actorName",${field('entity,label')} AS "entityLabel",${field('action,label')} AS "actionLabel",
     jsonb_array_length(c.presentation->'changes') AS "changeCount"
    FROM "ChangeLog" c WHERE ${journalPreparedWhere(query)} ORDER BY ${journalOrder(query)} LIMIT ${limit} OFFSET ${offset}`);
   return rows.map(row=>({...row,createdAt:row.createdAt.toISOString(),hasChanges:row.changeCount>0}));
  },
  async find(id){
   const rows=await db.$queryRaw<JournalStoredEntry[]>(Prisma.sql`SELECT ${rawColumns} FROM "ChangeLog" c WHERE c.id=${id}`);
   return (await resolveJournalEntries(db,rows))[0]??null;
  },
  async preparedOptions(scope){
   pageSnapshot=null;pendingIds=null;pageKey='';
   const within=scope.kind==='global'?Prisma.sql`TRUE`:Prisma.sql`j.contexts @> ${JSON.stringify([{kind:scope.kind,id:scope.id}])}::jsonb`;
   const [result]=await db.$queryRaw<{entries:Omit<JournalOptionRecord,'entityLabel'>[];pendingIds:string[]}[]>(Prisma.sql`
    WITH ${classification(normalizeJournalQuery({}))}
    SELECT COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('actorType',j.actor->>'type','actorId',j.actor->>'id','actorName',j.actor->>'name','entity',j.entity->>'type'))
     FROM classified r JOIN "ChangeLog" c ON c.id=r.id CROSS JOIN LATERAL
      jsonb_to_record(CASE WHEN r.kind='event' THEN c.presentation ELSE '{}'::jsonb END) AS j(actor jsonb,entity jsonb,contexts jsonb)
     WHERE r.kind='event' AND ${within}),'[]'::jsonb) AS entries,
     COALESCE((SELECT jsonb_agg(r.id ORDER BY r.id COLLATE "C") FROM classified r WHERE r.kind IS NULL),'[]'::jsonb) AS "pendingIds"`);
   pendingIds=result.pendingIds;
   return result.entries.map(row=>({...row,entityLabel:journalEntityLabel(row.entity)}));
  },
  async users(){return db.$queryRaw<{id:string;name:string}[]>`SELECT id,name FROM "User" ORDER BY name,id`;},
  entityLabel:journalEntityLabel,
 };
}
