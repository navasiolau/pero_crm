import type {JournalPresentation,JournalScope} from './contract';

export const JOURNAL_SYSTEM_ACTOR='__system__';
export type JournalSort='time'|'actor'|'entity'|'action';
export type JournalQueryInput={scope?:JournalScope;q?:string;actorId?:string;entity?:string;from?:string;to?:string;page?:number;pageSize?:number;sort?:JournalSort;dir?:'asc'|'desc'};
export type JournalQuery={scope:JournalScope;q:string;actorId:string;entity:string;fromAt:Date|null;toBefore:Date|null;page:number;pageSize:number;sort:JournalSort;dir:'asc'|'desc'};
export type JournalListRow={id:string;createdAt:string;actorName:string;entityLabel:string;actionLabel:string;changeCount:number;hasChanges:boolean};
export type JournalPage={entries:JournalListRow[];total:number;page:number;pageSize:number;sort:JournalSort;dir:'asc'|'desc'};
export type JournalEntryDetail={id:string;createdAt:string;presentation:JournalPresentation};
export type JournalFilterOption={id:string;label:string};
export type JournalFilterOptions={users:JournalFilterOption[];entities:JournalFilterOption[]};

const object=(value:unknown):Record<string,unknown>|null=>typeof value==='object'&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:null;
function optionalText(value:unknown,max:number,label:string):string{
 if(value===undefined||value===null)return '';
 if(typeof value!=='string'||value.length>max||value.includes('\0'))throw Error(`Некорректное значение ${label}`);
 return value.trim();
}

/** Неизвестный контекст нельзя молча превратить в общий журнал. */
export function normalizeJournalScope(input:unknown):JournalScope{
 if(input===undefined)return {kind:'global'};
 const value=object(input);
 if(value?.kind==='global'&&Object.keys(value).every(key=>key==='kind'))return {kind:'global'};
 if((value?.kind==='project'||value?.kind==='product')&&typeof value.id==='string'&&value.id.trim()&&value.id.length<=200&&
  !/[\u0000-\u001f\u007f]/.test(value.id)&&Object.keys(value).every(key=>key==='kind'||key==='id'))return {kind:value.kind,id:value.id};
 throw Error('Некорректный контекст журнала');
}

function moscowDay(value:unknown):Date|null{
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Некорректная дата журнала');
 const [year,month,day]=value.split('-').map(Number);
 const check=new Date(`${value}T00:00:00.000Z`);
 if(year<1000||!Number.isFinite(check.getTime())||check.getUTCFullYear()!==year||check.getUTCMonth()+1!==month||check.getUTCDate()!==day)throw Error('Некорректная дата журнала');
 return new Date(check.getTime()-3*60*60*1000);
}

export function normalizeJournalQuery(input:JournalQueryInput|unknown={}):JournalQuery{
 const value=object(input);if(!value)throw Error('Некорректные фильтры журнала');
 const page=value.page??1,pageSize=value.pageSize??20,sort=value.sort??'time',dir=value.dir??'desc';
 if(typeof page!=='number'||!Number.isSafeInteger(page)||page<1||typeof pageSize!=='number'||![10,20,50,100].includes(pageSize))throw Error('Некорректная страница журнала');
 if(typeof sort!=='string'||typeof dir!=='string'||!['time','actor','entity','action'].includes(sort)||!['asc','desc'].includes(dir))throw Error('Некорректная сортировка журнала');
 const fromAt=moscowDay(value.from),toAt=moscowDay(value.to);
 if(fromAt&&toAt&&fromAt>toAt)throw Error('Некорректный период журнала');
 return {scope:normalizeJournalScope(value.scope),q:optionalText(value.q,4000,'поиска'),actorId:optionalText(value.actorId,200,'пользователя'),
  entity:optionalText(value.entity,100,'сущности'),fromAt,toBefore:toAt?new Date(toAt.getTime()+86_400_000):null,page,pageSize,sort:sort as JournalSort,dir:dir as 'asc'|'desc'};
}

export function escapeJournalLike(value:string):string{return value.replace(/[\\%_]/g,match=>`\\${match}`);}
