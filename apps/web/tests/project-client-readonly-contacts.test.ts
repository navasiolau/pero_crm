import assert from 'node:assert/strict';
import {createRequire,Module} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import test from 'node:test';
const require=createRequire(import.meta.url);
function inject(path:string,exports:Record<string,unknown>){const file=require.resolve(path);const stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
inject('../src/lib/independent-project-action',{invokeProjectPatch(){throw Error('SSR_WRITE_FORBIDDEN')}});
inject('../src/server/clients/actions',{createClient(){throw Error('SSR_WRITE_FORBIDDEN')},updateClient(){throw Error('SSR_WRITE_FORBIDDEN')}});
inject('../src/components/project-stage-control',{ProjectStageControl(){return React.createElement('div',null,'Статус')}});
(globalThis as unknown as {React:typeof React}).React=React;
const {ProjectInlineProvider}=require('../src/components/project-inline-provider') as typeof import('../src/components/project-inline-provider');
const {OverviewTab}=require('../src/app/(app)/projects/[id]/overview-tab') as typeof import('../src/app/(app)/projects/[id]/overview-tab');
const initial={title:'Order',clientId:'b',managerId:null,address:'HISTORIC PROJECT ADDRESS','client.phone':'old phone',delivery:null,unloading:null,installation:null};
// eslint-disable-next-line react/no-children-prop -- provider требует children в typed props
function render(canManage:boolean){return renderToStaticMarkup(React.createElement(ProjectInlineProvider,{projectId:'project',initial,stage:'LEAD',pricingProjection:null,children:React.createElement(OverviewTab,{project:{id:'project',number:'1',stage:'LEAD',stageChangedAt:new Date(0),createdAt:new Date(0),currency:'BYN',refusalReason:null,refusalComment:null,reclamationReason:null,reclamationDescription:null,reclamationFault:null},createdByName:null,canManage,showAmount:false,clients:[{id:'a',label:'A',phone:'100',address:'Client A'},{id:'b',label:'B',phone:'200',address:'Client B'}],managers:[],productEngineers:[],doneAt:null})}));}
test('project contacts are readonly selected Client data, never historical Project.address',()=>{
 const html=render(true);assert.match(html,/Client B/);assert.match(html,/>200</);assert.doesNotMatch(html,/HISTORIC PROJECT ADDRESS/);assert.doesNotMatch(html,/<input[^>]+id="project-inline-(?:phone|address)"/);assert.match(html,/project-client-phone/);assert.match(html,/project-client-address/);
});
test('readonly role cannot create client while manager reuses create experience',()=>{assert.doesNotMatch(render(false),/Новый клиент/);assert.match(render(true),/Новый клиент/);});

 test('client selection ACK supplies actual Client address without overwriting project history/services',async()=>{
 const {patchProjectCore}=await import('../src/server/projects/project-field-core');
 const state={id:'project',clientId:'a',address:'Historical delivery destination',delivery:'35.00'};
 const clients=[{id:'a',name:'A',lastName:null,middleName:null,phone:'100',address:'Client A'},{id:'b',name:'B',lastName:null,middleName:null,phone:'200',address:'Client B'}];
 let writes=0;
 const tx={$queryRaw:async()=>[],project:{findUnique:async()=>({...state}),updateMany:async({data}:{data:Partial<typeof state>})=>{Object.assign(state,data);writes++;return{count:1};}},client:{findUnique:async({where}:{where:{id:string}})=>clients.find(row=>row.id===where.id)},changeLog:{findUnique:async()=>null,create:async()=>({})},domainEvent:{create:async()=>({})}} as unknown as import('@prisma/client').Prisma.TransactionClient;
 const transaction:import('../src/server/tasks/transaction').TaskTransaction=async fn=>fn(tx);
 const actor={id:'manager',name:'Manager',roles:['MANAGER' as const],source:'web' as const};
 const input={projectId:'project',field:'clientId' as const,value:'b',expectedValue:'a',clientMutationId:'11111111-1111-4111-8111-111111111111'};
 const reply=await patchProjectCore(actor,input,transaction);
 assert.equal(reply.kind,'saved');if(reply.kind==='saved'){assert.equal(reply.derived?.clientAddress,'Client B');assert.equal(reply.derived?.phone,'200');}
 assert.equal(state.clientId,'b');assert.equal(state.address,'Historical delivery destination');assert.equal(state.delivery,'35.00');assert.equal(writes,1);
 const stale=await patchProjectCore(actor,{...input,value:'a',clientMutationId:'22222222-2222-4222-8222-222222222222'},transaction);assert.equal(stale.kind,'conflict');assert.equal(writes,1);
 });
