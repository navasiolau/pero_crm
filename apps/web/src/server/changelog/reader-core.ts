import type {JournalPresentation,JournalScope} from './contract';
import {JOURNAL_SYSTEM_ACTOR,type JournalQuery,type JournalListRow,type JournalPage,type JournalEntryDetail,type JournalFilterOptions} from './query-contract';

export type JournalResolvedEntry={id:string;createdAt:Date;presentation:JournalPresentation;searchText:string};
export type JournalOptionRecord={actorType:string;actorId:string;actorName:string;entity:string;entityLabel:string};
export interface JournalReadStore{
 pending(afterId:string|null,limit:number,query?:JournalQuery):Promise<JournalResolvedEntry[]>;
 preparedCount(query:JournalQuery):Promise<number>;
 preparedRows(query:JournalQuery,limit:number,offset?:number):Promise<JournalListRow[]>;
 find(id:string):Promise<JournalResolvedEntry|null>;
 preparedOptions(scope:JournalScope):Promise<JournalOptionRecord[]>;
 users():Promise<{id:string;name:string}[]>;
 entityLabel?(type:string):string;
}
const LEGACY_BATCH_SIZE=250;

export function journalInScope(presentation:JournalPresentation,scope:JournalScope):boolean{
 if(presentation.kind!=='event')return false;
 if(scope.kind==='global')return true;
 return presentation.contexts.some(context=>context.kind===scope.kind&&context.id===scope.id);
}

export function journalMatches(entry:JournalResolvedEntry,query:JournalQuery):boolean{
 const p=entry.presentation;
 return journalInScope(p,query.scope)&&(!query.q||entry.searchText.toLowerCase().includes(query.q.toLowerCase()))&&
  (!query.actorId||(query.actorId===JOURNAL_SYSTEM_ACTOR?p.actor.type==='system':p.actor.type==='user'&&p.actor.id===query.actorId))&&
  (!query.entity||p.entity.type===query.entity)&&(!query.fromAt||entry.createdAt>=query.fromAt)&&(!query.toBefore||entry.createdAt<query.toBefore);
}

export function journalSummary(entry:JournalResolvedEntry):JournalListRow{
 const p=entry.presentation;
 return {id:entry.id,createdAt:entry.createdAt.toISOString(),actorName:p.actor.name,entityLabel:p.entity.label,
  actionLabel:p.action.label,changeCount:p.changes.length,hasChanges:p.changes.length>0};
}

/** Сопоставимо с PostgreSQL lower(text) COLLATE "C", в том числе для символов вне BMP. */
function compareText(left:string,right:string,foldCase=true):number{
 const a=Array.from(foldCase?left.toLowerCase():left),b=Array.from(foldCase?right.toLowerCase():right);
 for(let i=0;i<Math.min(a.length,b.length);i++){const difference=a[i].codePointAt(0)!-b[i].codePointAt(0)!;if(difference)return difference;}
 return a.length-b.length;
}
export function compareJournalRows(query:Pick<JournalQuery,'sort'|'dir'>):(a:JournalListRow,b:JournalListRow)=>number{
 return (a,b)=>{
  const primary=query.sort==='time'?compareText(a.createdAt,b.createdAt):query.sort==='actor'?compareText(a.actorName,b.actorName):query.sort==='entity'?compareText(a.entityLabel,b.entityLabel):compareText(a.actionLabel,b.actionLabel);
  return (query.dir==='asc'?primary:-primary)||compareText(b.createdAt,a.createdAt)||compareText(b.id,a.id,false);
 };
}

export async function readJournalPage(store:JournalReadStore,query:JournalQuery):Promise<JournalPage>{
 const compare=compareJournalRows(query),pending:JournalListRow[]=[];
 let cursor:string|null=null,pendingTotal=0;
 const retain=Math.min(Number.MAX_SAFE_INTEGER,query.page*query.pageSize);
 while(true){
  const batch=await store.pending(cursor,LEGACY_BATCH_SIZE,query);
  for(const entry of batch)if(journalMatches(entry,query)){pendingTotal++;pending.push(journalSummary(entry));}
  if(pending.length>retain){pending.sort(compare);pending.length=retain;}
  if(batch.length<LEGACY_BATCH_SIZE)break;
  const next=batch.at(-1)!.id;if(next===cursor)throw Error('JOURNAL_CURSOR_STALLED');cursor=next;
 }
 const preparedTotal=await store.preparedCount(query),total=pendingTotal+preparedTotal;
 const page=Math.min(query.page,Math.max(1,Math.ceil(total/query.pageSize))),end=page*query.pageSize;
 const prepared=await store.preparedRows(query,pendingTotal?end:query.pageSize,pendingTotal?0:end-query.pageSize);
 const entries=pendingTotal?[...pending,...prepared].sort(compare).slice(end-query.pageSize,end):prepared;
 return {entries,total,page,pageSize:query.pageSize,sort:query.sort,dir:query.dir};
}

export async function readJournalDetail(store:JournalReadStore,id:string,scope:JournalScope):Promise<JournalEntryDetail>{
 if(typeof id!=='string'||!id||id.length>200||/[\u0000-\u001f\u007f]/.test(id))throw Error('Запись журнала не найдена');
 const entry=await store.find(id);
 if(!entry||!journalInScope(entry.presentation,scope))throw Error('Запись журнала не найдена');
 return {id:entry.id,createdAt:entry.createdAt.toISOString(),presentation:entry.presentation};
}

export async function readJournalOptions(store:JournalReadStore,scope:JournalScope):Promise<JournalFilterOptions>{
 const names=new Map<string,Set<string>>(),entities=new Map<string,string>();
 const add=(row:JournalOptionRecord)=>{
  if(row.actorType==='user'){const set=names.get(row.actorId)??new Set<string>();set.add(row.actorName);names.set(row.actorId,set);}
  entities.set(row.entity,row.entityLabel);
 };
 for(const row of await store.preparedOptions(scope))add(row);
 let cursor:string|null=null;
 while(true){
  const batch=await store.pending(cursor,LEGACY_BATCH_SIZE);
  for(const entry of batch)if(journalInScope(entry.presentation,scope)){const p=entry.presentation;add({actorType:p.actor.type,actorId:p.actor.id,actorName:p.actor.name,entity:p.entity.type,entityLabel:store.entityLabel?.(p.entity.type)??p.entity.type});}
  if(batch.length<LEGACY_BATCH_SIZE)break;
  const next=batch.at(-1)!.id;if(next===cursor)throw Error('JOURNAL_CURSOR_STALLED');cursor=next;
 }
 const current=new Map((await store.users()).map(user=>[user.id,user.name]));
 for(const [id,name]of current){const aliases=names.get(id)??new Set<string>();aliases.add(name);names.set(id,aliases);}
 const users=[...names].map(([id,aliases])=>{const preferred=current.get(id)??[...aliases][0]??'Имя не сохранено';const historical=[...aliases].filter(name=>name!==preferred);return {id,label:historical.length?`${preferred} (в истории: ${historical.join('; ')})`:preferred};});
 users.sort((a,b)=>a.label.localeCompare(b.label,'ru')||a.id.localeCompare(b.id));
 return {users:[{id:JOURNAL_SYSTEM_ACTOR,label:'Система'},...users],entities:[...entities].map(([id,label])=>({id,label})).sort((a,b)=>a.label.localeCompare(b.label,'ru')||a.id.localeCompare(b.id))};
}
