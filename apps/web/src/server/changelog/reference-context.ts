import type {JournalEntryInput,JournalPresentationHints,JournalScope,JournalValue} from './contract';

export type JournalReference={type:string;id:string;label:string;href?:string;number?:string;projectId?:string|null;productId?:string|null;taskId?:string|null;ownership?:'fixed'|'mutable';createdAt?:Date};
export type JournalReferenceMap=Map<string,JournalReference>;
export const referenceKey=(type:string,id:string)=>`${type}:${id}`;
const obj=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const str=(value:unknown)=>typeof value==='string'&&value.length>0?value:undefined;
const projectOnly=new Set(['payment','commercialProposal','proposalContract','proposalMedia','proposalArtifact','communication','logisticsTrip','logisticsDocument','logisticsPosting']);
const linkedEntities=new Set(['task','work','file','projectMaterial','stockMovement','payrollEntry','timeEntry','taskAllocationGroup']);

function snapshots(entry:JournalEntryInput):Record<string,unknown>[] {
 const before=obj(entry.oldValue),after=obj(entry.newValue);
 return [before,after,obj(before.context),obj(after.context),obj(obj(before.result).context),obj(obj(after.result).context)];
}
function reference(map:JournalReferenceMap,type:string,id:string){return map.get(referenceKey(type,id));}
function context(map:JournalReferenceMap,kind:'project'|'product',id:string){
 const known=reference(map,kind,id);
 return {kind,id,label:known?.label??(kind==='project'?'Проект':'Изделие'),href:`/${kind==='project'?'projects':'products'}/${encodeURIComponent(id)}`};
}
function selfLabel(entry:JournalEntryInput):string|undefined{
 const after=obj(entry.newValue),before=obj(entry.oldValue);
 const number=str(after.number)??str(before.number);
 if(number&&(entry.entity==='project'||entry.entity==='product'))return `${entry.entity==='project'?'Проект':'Изделие'} ${number}`;
 const title=str(after.title)??str(before.title)??str(after.fileName)??str(before.fileName)??str(after.name)??str(before.name);
 return title;
}

/** Текущий Task.productId не используется: эту связь можно менять без изменения ID задачи. */
export function deriveLegacyJournalHints(entry:JournalEntryInput,map:JournalReferenceMap):JournalPresentationHints{
 const known=reference(map,entry.entity,entry.entityId),snapshotLabel=selfLabel(entry),hints:JournalPresentationHints={};
 if(snapshotLabel)hints.entity={label:entry.entity==='project'||entry.entity==='product'?snapshotLabel:`${entityPrefix(entry.entity)} ${snapshotLabel}`.trim(),...(known?.href?{href:known.href}:{})};
 else if(known)hints.entity={label:known.label,...(known.href?{href:known.href}:{})};
 if(!entry.actorName&&entry.actorType==='user'){
  const author=reference(map,'user',entry.actorId);
  if(author)hints.actor={type:'user',id:entry.actorId,name:author.label};
 }
 if(entry.entity==='project'||entry.entity==='product'){
  const ownContext=context(map,entry.entity,entry.entityId);
  hints.contexts=[{...ownContext,label:hints.entity?.label??ownContext.label}];return hints;
 }
 if(!projectOnly.has(entry.entity)&&!linkedEntities.has(entry.entity))return hints;
 const states=snapshots(entry),products=new Set<string>(),projects=new Set<string>();
 let explicitEmptyProduct=false;
 for(const state of states){
  if(typeof state.productId==='string'&&state.productId)products.add(state.productId);
  if(Object.hasOwn(state,'productId')&&state.productId===null)explicitEmptyProduct=true;
  if(typeof state.projectId==='string'&&state.projectId)projects.add(state.projectId);
  if(projectOnly.has(entry.entity)){
   if(Array.isArray(state.projectIds))for(const id of state.projectIds)if(typeof id==='string'&&id)projects.add(id);
   const projectNumber=str(state.project);
   if(projectNumber){const project=reference(map,'projectNumber',projectNumber);if(project)projects.add(project.id);}
  }
 }
 // Владение у этих строк задаётся при создании и не редактируется. Для старого события строка должна уже существовать.
 const currentIsEvidence=known?.ownership==='fixed'&&(!known.createdAt||!entry.createdAt||known.createdAt<=new Date(entry.createdAt));
 if(currentIsEvidence){
  if(known.productId)products.add(known.productId);
  else if(known.productId===null&&!known.taskId){explicitEmptyProduct=true;if(known.projectId)projects.add(known.projectId);}
  if(projectOnly.has(entry.entity)&&known.projectId)projects.add(known.projectId);
 }
 if(products.size)hints.contexts=[...products].map(id=>context(map,'product',id));
 else if(projectOnly.has(entry.entity)||explicitEmptyProduct)hints.contexts=[...projects].map(id=>context(map,'project',id));
 // Отсутствующая или неоднозначная связь остаётся только в общем журнале.
 return hints;
}

function entityPrefix(entity:string):string{
 const prefixes:Record<string,string>={task:'Задача',work:'Работа',file:'Файл',user:'Пользователь',client:'Клиент',material:'Материал',priceItem:'Расценка',counterparty:'Контрагент',cashAccount:'Касса',expenseArticle:'Статья расходов'};
 return Object.hasOwn(prefixes,entity)?prefixes[entity]:'';
}

/** Происхождение подписи хранится в подробностях и не засоряет каждую строку таблицы. */
export function legacyReferenceOrigins(entry:JournalEntryInput,map:JournalReferenceMap):Record<string,JournalValue>{
 const result:Record<string,JournalValue>={},known=reference(map,entry.entity,entry.entityId);
 if(selfLabel(entry))result.entity={source:'snapshot',type:entry.entity,id:entry.entityId};
 else if(known)result.entity={source:'current',type:entry.entity,id:entry.entityId,label:known.label};
 if(!entry.actorName&&entry.actorType==='user'){
  const author=reference(map,'user',entry.actorId);
  if(author)result.actor={source:'current',id:entry.actorId,name:author.label};
 }
 return result;
}

export function collectJournalReferences(entries:JournalEntryInput[]):Map<string,Set<string>>{
 const needed=new Map<string,Set<string>>();
 const add=(type:string,id:unknown)=>{if(typeof id!=='string'||!id)return;const ids=needed.get(type)??new Set<string>();ids.add(id);needed.set(type,ids);};
 for(const entry of entries){
  add(entry.entity,entry.entityId);if(entry.actorType==='user')add('user',entry.actorId);
  for(const state of snapshots(entry)){
   add('project',state.projectId);add('product',state.productId);add('projectNumber',state.project);
   if(Array.isArray(state.projectIds))for(const id of state.projectIds)add('project',id);
  }
  function visit(value:unknown,key=''){
   if(Array.isArray(value)){for(const item of value)visit(item,key);return;}
   if(value!==null&&typeof value==='object'){for(const [name,item]of Object.entries(value))visit(item,name);return;}
   const type=journalReferenceFieldType(key);if(type)add(type,value);
  }
  visit(entry.oldValue);visit(entry.newValue);
 }
 return needed;
}

export function journalReferenceFieldType(key:string):string|undefined{
 if(['userId','actorId','initiatorId','engineerId','assigneeId','managerId','assemblerId','installerId','createdById','updatedById','deletedById','uploadedById','doneById'].includes(key))return 'user';
 const types:Record<string,string>={clientId:'client',productId:'product',projectId:'project',taskId:'task',workId:'work',materialId:'material',materialCategoryId:'materialCategory',unitId:'materialUnit',cashAccountId:'cashAccount',expenseArticleId:'expenseArticle',priceItemId:'priceItem',fileId:'file',sketchFileId:'file',coverFileId:'file',proposalId:'commercialProposal'};
 return Object.hasOwn(types,key)?types[key]:undefined;
}

export function scopeMatchesContext(contexts:NonNullable<JournalPresentationHints['contexts']>,scope:JournalScope):boolean{
 return scope.kind==='global'||contexts.some(value=>value.kind===scope.kind&&value.id===scope.id);
}
