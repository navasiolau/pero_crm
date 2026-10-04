import assert from 'node:assert/strict';
import {createRequire,Module} from 'node:module';
import {test} from 'node:test';
import {Prisma} from '@prisma/client';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name);const stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
let articleActive=true,articleReads=0,deactivateBeforeTransaction=false;
const projectCurrency='BYN';let fxCalls=0,writes=0;let projectReads=0,auditFails=false,audits=0,events=0;let saved:Record<string,unknown>={};
const tx={changeLog:{create:async()=>{if(auditFails)throw Error('audit failed');audits++;return{id:'audit'}}},domainEvent:{create:async()=>{events++;return{id:'event'}}},project:{findUnique:async()=>{projectReads++;return{id:'p',number:'P',currency:projectCurrency}}},cashAccount:{findUnique:async()=>{return{id:'cash',name:'USD cash',active:true,currency:'USD'}}},orgSetting:{findUnique:async()=>({value:'USD'})},expenseArticle:{findUnique:async({where}:{where:{id:string}})=>{articleReads++;return where.id==='article'?{id:'article',active:articleActive}:null}},payment:{create:async({data}:{data:Record<string,unknown>})=>{writes++;saved=data;return{id:'payment',...data}}}};
inject('../src/lib/prisma',{prisma:tx});inject('next/cache',{revalidatePath:()=>{}});
inject('../src/server/projects/core',{requireActorRoles:()=>{}});
inject('../src/server/plugins/changelog',{writeChangeLog:async()=>{}});inject('../src/server/plugins/events',{emitDomainEvent:async()=>{},dispatchEvent:async()=>{}});inject('../src/server/notifications/notify',{notifyOrg:async()=>{}});
inject('../src/server/tasks/transaction',{withTaskTransaction:async(fn:(t:typeof tx)=>unknown)=>{const before={writes,audits,events,saved};try{if(deactivateBeforeTransaction)articleActive=false;return await fn(tx)}catch(e){({writes,audits,events,saved}=before);throw e}}});
inject('../src/server/finance/nbrb',{isCurrency:(v:string)=>['BYN','USD','EUR','RUB'].includes(v),getNbrbRate:async()=>{fxCalls++;return{rate:3,date:'2026-10-02'}},equivalents:(amount:number,rate:number,projectRate:number)=>({bynAmount:Math.round(amount*rate*100)/100,projectAmount:Math.round(amount*rate/projectRate*100)/100})});
inject('../src/server/payroll/cash-core',{readCashBalance:async()=>new Prisma.Decimal(1000),readOrgBalance:async(_tx:unknown,rate:string,delta:string)=>{assert.equal(rate,'1.000000');assert.equal(delta,'-300.00');return new Prisma.Decimal(1000)}});
const {createPaymentCore,createPaymentInTransaction}=require('../src/server/payments/core') as typeof import('../src/server/payments/core');
const actor={id:'a',name:'A',roles:['ACCOUNTANT' as const],source:'web' as const};
const input={projectId:'p',direction:'INCOME' as const,amount:100,currency:'USD',cashAccountId:'cash'};

test('general income stores two project NULLs and one physical USD/BYN snapshot without Project reads',async()=>{writes=audits=events=projectReads=fxCalls=0;const result=await createPaymentCore(actor,{...input,projectId:null});assert.equal(result.ok,true);assert.equal(projectReads,0);assert.equal(writes,1);assert.equal(audits,1);assert.equal(events,1);assert.equal(saved.projectId,null);assert.equal(saved.projectAmount,null);assert.equal(saved.amount,100);assert.equal(saved.bynAmount,300);assert.equal(fxCalls,1);});
test('expense missing target rejects before DB/FX',async()=>{projectReads=fxCalls=writes=0;const result=await createPaymentCore(actor,{...input,projectId:null,direction:'EXPENSE',expenseArticleId:'article'});assert.equal(result.ok,false);assert.equal(projectReads+fxCalls+writes,0);});
test('audit failure rolls the general income back with no outbox',async()=>{writes=audits=events=0;auditFails=true;try{assert.equal((await createPaymentCore(actor,{...input,projectId:null,rate:3})).ok,false);assert.equal(writes+audits+events,0);}finally{auditFails=false;}});


test('selected income article persists for general and project-linked FX income without expense caps',async()=>{
 for(const projectId of [null,'p']){articleActive=true;articleReads=0;writes=0;
 assert.equal((await createPaymentCore(actor,{...input,projectId,expenseArticleId:'article',rate:3})).ok,true);
 assert.equal(saved.expenseArticleId,'article');assert.equal(saved.direction,'INCOME');assert.equal(saved.amount,100);assert.equal(saved.bynAmount,300);assert.equal(saved.projectAmount,projectId?300:null);assert.equal(writes,1);assert.equal(articleReads,2);}
});
test('unknown or inactive selected income article rejects before FX and write',async()=>{
 for(const id of ['unknown','article']){articleActive=id!=='article';writes=fxCalls=0;
 const result=await createPaymentCore(actor,{...input,expenseArticleId:id});assert.equal(result.ok,false);assert.equal(writes+fxCalls,0);}
 articleActive=true;
});
test('article deactivation between preparation and transaction rejects income atomically',async()=>{
 articleActive=true;deactivateBeforeTransaction=true;writes=audits=events=0;
 try{const result=await createPaymentCore(actor,{...input,expenseArticleId:'article',rate:3});assert.equal(result.ok,false);assert.equal(writes+audits+events,0);}finally{deactivateBeforeTransaction=false;articleActive=true;}
});
test('transaction refuses changed or omitted article in either input or prepared snapshot',async()=>{
 const prepared={project:null,account:{id:'cash',name:'USD cash'},articleId:'article',paidAt:new Date(),rate:3,rateDate:null,amount:100,bynAmount:300};
 for(const [inputArticle,preparedArticle] of [[undefined,'article'],['article',null],['other','article']] as const){writes=0;
 await assert.rejects(createPaymentInTransaction(actor,{...input,projectId:null,expenseArticleId:inputArticle},{...prepared,articleId:preparedArticle},tx as unknown as Prisma.TransactionClient),/\u0441\u0442\u0430\u0442/);assert.equal(writes,0);}
});
test('legacy income without article stays nullable and expense still requires article',async()=>{
 assert.equal((await createPaymentCore(actor,{...input,projectId:null,rate:3})).ok,true);assert.equal(saved.expenseArticleId,null);
 writes=0;const result=await createPaymentCore(actor,{...input,direction:'EXPENSE',rate:3});assert.equal(result.ok,false);assert.match(result.error??'',/\u0441\u0442\u0430\u0442/);assert.equal(writes,0);
});
