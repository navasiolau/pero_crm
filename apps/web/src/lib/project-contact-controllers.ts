import {createInlineSaveController, type InlineSaveController, type InlineValue} from './inline-save-controller';
import {parseProjectInlineValue} from './project-inline-values';
import {projectPatchSchema, type ProjectPatch, type ProjectPatchResult} from '@/server/projects/patch-contract';

export type ProjectContactInitial = {clientId:string; 'client.phone':string; 'client.address':string|null;clientVersion?:string};
type ContactField = 'clientId'|'client.phone'|'client.address';
type ContactSnapshot = {clientId:string;phone:InlineSaveController;address:InlineSaveController;switching:boolean};
type Save = (patch:ProjectPatch)=>Promise<ProjectPatchResult>;

/** Контакты принадлежат подтверждённому клиенту, а не черновику селекта. */
export function createProjectContactControllers(projectId:string,initial:ProjectContactInitial,save:Save){
 const listeners=new Set<()=>void>();
 const versionOf=(value:string|undefined)=>value!==undefined&&/^\d+$/.test(value)?BigInt(value):null;
 let appliedVersion=versionOf(initial.clientVersion),pendingServer:ProjectContactInitial|undefined;
 const advanceVersion=(value:string|undefined)=>{const next=versionOf(value);if(next!==null&&(appliedVersion===null||next>appliedVersion))appliedVersion=next;};
 const clean=(controller:InlineSaveController)=>['idle','saved'].includes(controller.getSnapshot().status);
 const publish=(value:ContactSnapshot)=>{snapshot=value;listeners.forEach(listener=>listener());};
 function fields(client:ProjectContactInitial){
  function field(name:'client.phone'|'client.address'){
   return createInlineSaveController<InlineValue>({initialValue:client[name],format:value=>value===null?'':String(value),isUnchangedDraft:(raw,baseline)=>raw===(baseline===null?'':String(baseline)),parse:raw=>parseProjectInlineValue(name,raw),save:async request=>{
    const reply=await save(projectPatchSchema.parse({projectId,field:name,...request,expectedClientId:client.clientId}));
    if(reply.kind==='saved')advanceVersion(reply.derived?.clientVersion);
    // Чужая смена связи не даёт автоматического rebase контакта на другого человека.
    if(reply.kind==='conflict'&&reply.currentClientId&&reply.currentClientId!==client.clientId)return{...reply,currentValue:undefined,error:'Клиент проекта изменён. Скопируйте ввод и откройте карточку заново.'};
    return reply;
   }});
  }
  return{clientId:client.clientId,phone:field('client.phone'),address:field('client.address'),switching:false};
 }
 let snapshot:ContactSnapshot=fields(initial);
 const serverSnapshot=snapshot;
 function bind(client:ProjectContactInitial){
  const before=snapshot;
  publish({...fields(client),switching:before.switching});
  watchContacts();
  before.phone.dispose();before.address.dispose();
 }
 const contactsFlush=async()=>{
  const group=snapshot;
  const saved=await Promise.all([group.phone.flush(),group.address.flush()]);
  return saved.every(Boolean)&&group.clientId===snapshot.clientId;
 };
 const client=createInlineSaveController<InlineValue>({initialValue:initial.clientId,format:value=>String(value),parse:raw=>parseProjectInlineValue('clientId',raw),save:async request=>{
  publish({...snapshot,switching:true});
  try{
   if(!await contactsFlush())return{kind:'failure',error:'Сначала сохраните или исправьте контакты текущего клиента'};
   const reply=await save(projectPatchSchema.parse({projectId,field:'clientId',...request}));
   if(reply.kind==='conflict')return{...reply,currentValue:undefined,error:'Клиент проекта изменён. Откройте карточку заново перед сменой клиента.'};
   if(reply.kind==='saved'){
    const next=reply.derived;
    if(next?.clientId!==reply.value||typeof next.phone!=='string'||next.clientAddress===undefined)return{kind:'failure',error:'Не получены контакты выбранного клиента. Обновите карточку.'};
    advanceVersion(next.clientVersion);
    bind({clientId:next.clientId,'client.phone':next.phone,'client.address':next.clientAddress});
   }
   return reply;
  }finally{publish({...snapshot,switching:false});}
 }});
 function defer(next:ProjectContactInitial){const incoming=versionOf(next.clientVersion),previous=versionOf(pendingServer?.clientVersion);if(!pendingServer||previous===null||incoming!==null&&incoming>=previous)pendingServer={...next};}
 function receive(next:ProjectContactInitial):boolean{
  const incoming=versionOf(next.clientVersion);
  if(appliedVersion!==null&&(incoming===null||incoming<appliedVersion))return false;
  if(snapshot.switching||!clean(client)){defer(next);return false;}
  if(snapshot.clientId!==next.clientId){
   if(!clean(snapshot.phone)||!clean(snapshot.address)){defer(next);return false;}
   if(!client.receive(next.clientId)){defer(next);return false;}
   advanceVersion(next.clientVersion);bind(next);
  }else{
   if(!client.receive(next.clientId)){defer(next);return false;}
   advanceVersion(next.clientVersion);snapshot.phone.receive(next['client.phone']);snapshot.address.receive(next['client.address']);
  }
  return true;
 }
 function applyPending(){if(!pendingServer||snapshot.switching||!clean(client)||!clean(snapshot.phone)||!clean(snapshot.address))return;const next=pendingServer;pendingServer=undefined;receive(next);}
 function watchContacts(){snapshot.phone.subscribeSettled(applyPending);snapshot.address.subscribeSettled(applyPending);}
 client.subscribeSettled(applyPending);watchContacts();
 return{
  controller:(field:ContactField)=>field==='clientId'?client:field==='client.phone'?snapshot.phone:snapshot.address,
  getSnapshot:()=>snapshot,getServerSnapshot:()=>serverSnapshot,
  subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
  flush:async()=>await contactsFlush()&&await client.flush(),
  receive,
 };
}
