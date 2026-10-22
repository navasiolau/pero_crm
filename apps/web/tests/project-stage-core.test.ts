import assert from "node:assert/strict";
import { test } from "node:test";
import { type Prisma } from "@prisma/client";
import { patchProjectStageTransaction } from "../src/server/projects/stage-core";
import { projectStagePatchSchema, validateStageExtras } from "../src/server/projects/stage-contract";
import { createHash } from "node:crypto";
import { applyStageRetirement, planStageRetirement, retiredProjectTarget, type StageRetirementPorts } from "../src/server/projects/stage-retirement";

// Источник: project-stage-core.test.ts
const actor={id:'m',name:'Менеджер',roles:['MANAGER' as const],source:'web' as const};
const patch={projectId:'p',expectedStage:'LEAD',toStage:'REFUSED',clientMutationId:'b5428289-23f7-4e42-a967-212da990d141'};
function fixture(){
 const state={project:{id:'p',stage:'LEAD',number:'П1',title:'Заказ',refusalReason:null as string|null},audit:[] as Record<string,unknown>[],history:[] as unknown[],events:[] as unknown[],locks:0,fail:false};
 const tx={$queryRaw:async()=>{state.locks++;return[]},project:{findUnique:async()=>({...state.project}),updateMany:async({where,data}:{where:{stage:string};data:Record<string,unknown>})=>{if(state.project.stage!==where.stage)return{count:0};Object.assign(state.project,data);return{count:1}}},changeLog:{findUnique:async({where}:{where:{id:string}})=>state.audit.find(x=>x.id===where.id)??null,create:async({data}:{data:Record<string,unknown>})=>{state.audit.push(data);return data}},projectStageHistory:{create:async({data}:{data:unknown})=>{state.history.push(data)}},domainEvent:{create:async({data}:{data:unknown})=>{if(state.fail)throw Error('outbox');state.events.push(data);return{id:'event'}}}} as unknown as Prisma.TransactionClient;
 const run=async(input:unknown,who=actor)=>{const before=structuredClone(state);try{return(await patchProjectStageTransaction(who,input,tx)).result}catch(error){Object.assign(state,before);throw error}};
 return{state,run};
}
test('missing refusal and retired stage requests reject before all stage writes',async()=>{
 const f=fixture();for(const toStage of ['REFUSED','RECLAMATION','PAUSED']){assert.equal((await f.run({...patch,toStage,extras:{reclamationReason:'r',reclamationDescription:'d',reclamationFault:'f'}})).kind,'validation');assert.equal(f.state.project.stage,'LEAD');assert.equal(f.state.audit.length+f.state.history.length+f.state.events.length,0)}
 const old={...patch,toStage:'RECLAMATION',extras:{reclamationReason:'r',reclamationDescription:'d',reclamationFault:'f'}};
 f.state.audit.push({id:`project-stage:${old.clientMutationId}`,actorType:'user',actorId:actor.id,field:'stage',entity:'project',entityId:'p',action:'stage',newValue:{fingerprint:createHash('sha256').update(JSON.stringify(projectStagePatchSchema.parse(old))).digest('hex'),stage:old.toStage}});
 assert.equal((await f.run(old)).replayed,true);assert.equal(f.state.history.length+f.state.events.length,0);
 assert.equal((await f.run({...old,clientMutationId:'d5428289-23f7-4e42-a967-212da990d141'})).kind,'validation');
});
test('CAS competing transitions, optional comment and exact receipt replay',async()=>{
 const f=fixture();const input={...patch,extras:{refusalReason:' дорого '}};assert.equal((await f.run(input)).kind,'saved');assert.equal(f.state.project.refusalReason,'дорого');
 assert.equal((await f.run({...patch,toStage:'IN_WORK',clientMutationId:'d5428289-23f7-4e42-a967-212da990d141'})).kind,'conflict');
 assert.equal((await f.run(input)).replayed,true);assert.equal(f.state.audit.length,1);assert.equal(f.state.events.length,1);assert.equal(f.state.history.length,1);
 assert.equal((await f.run({...input,extras:{refusalReason:'иной'}})).kind,'validation');
});
test('historical same-stage no-op does not backfill extras or record receipt',async()=>{
 const f=fixture();f.state.project.stage='REFUSED';assert.equal((await f.run({...patch,expectedStage:'REFUSED'})).noOp,true);assert.equal(f.state.project.refusalReason,null);assert.equal(f.state.audit.length+f.state.history.length+f.state.events.length,0);
});
test('authorization before replay/conflict and manager union',async()=>{
 const f=fixture();for(const roles of [['ENGINEER'],['ACCOUNTANT'],['WORKER'],['MOUNTER']]){const result=await f.run(patch,{...actor,roles:roles as typeof actor.roles});assert.equal(result.kind,'forbidden');assert.equal(result.stage,undefined)}assert.equal(f.state.locks,0);
 assert.equal((await f.run({...patch,toStage:'IN_WORK'},{...actor,roles:['MANAGER','ENGINEER'] as typeof actor.roles})).ok,true);
});
test('outbox failure rolls back stage/date/history/audit atomically',async()=>{
 const f=fixture();f.state.fail=true;await assert.rejects(f.run({...patch,toStage:'IN_WORK'}),/outbox/);assert.equal(f.state.project.stage,'LEAD');assert.equal(f.state.audit.length+f.state.history.length+f.state.events.length,0);assert.equal('stageChangedAt' in f.state.project,false);
});

// Источник: project-stage-contract.test.ts
const input={projectId:'p',toStage:'REFUSED',expectedStage:'LEAD',clientMutationId:'b5428289-23f7-4e42-a967-212da990d141'};
test('closed stage contract requires captured baseline and UUID',()=>{
 assert.equal(projectStagePatchSchema.safeParse(input).success,true);
 for(const value of [null,[],{...input,expectedStage:undefined},{...input,clientMutationId:'bad'},{...input,currency:'USD'},{...input,extras:{unknown:'x'}}])assert.equal(projectStagePatchSchema.safeParse(value).success,false);
});
test('real refusal requires reason but comment is optional; reclamation requires all three fields',()=>{
 assert.deepEqual(validateStageExtras('REFUSED',{}),{refusalReason:'Укажите причину отказа'});
 assert.deepEqual(validateStageExtras('REFUSED',{refusalReason:' good '}),{});
 assert.equal(Object.keys(validateStageExtras('RECLAMATION',{})).length,3);
 assert.deepEqual(validateStageExtras('RECLAMATION',{reclamationReason:'r',reclamationDescription:'d',reclamationFault:'f'}),{});
});

test('retirement preserves hidden records, history and money; LEAD cancels only pending cleanup, exact replay is inert',async()=>{
 const now=new Date('2026-10-22T00:00:00Z');
 const target={kind:'local5433' as const,revision:'a'.repeat(40),imageDigest:'sha256:'+ 'b'.repeat(64),database:{name:'pero_crm',schema:'public' as const,systemIdentifier:'12345'}};
 const h={id:'old',fromStage:'LEAD' as const,toStage:'PAUSED' as const,createdAt:new Date(0)};
 const state={projects:[{id:'p',stage:'PAUSED',stageChangedAt:new Date(0),deletedAt:new Date(1),stageHistory:[h]}],products:[{id:'x',projectId:'p',status:'RECLAMATION',statusChangedAt:new Date(0),deletedAt:new Date(1)}],proposals:[{id:'cp',projectId:'p',revision:7,acceptedVersionId:'v',acceptedAt:new Date(0) as Date|null,retentionEpoch:3,deletedAt:null}],jobs:[{id:'prune',proposalId:'cp',state:'PENDING',attempts:0,leaseOwner:null,leaseUntil:null}],audit:[] as Record<string,unknown>[],money:{payroll:'45.00',completionStatus:'RECLAMATION',pdfHash:'unchanged'}};
 const tx={user:{findUnique:async()=>({...actor,roles:['ADMIN'],active:true})},
  project:{findMany:async()=>structuredClone(state.projects.filter(p=>['PAUSED','RECLAMATION'].includes(p.stage))),updateMany:async({where,data}:{where:{id:string;stage:string};data:object})=>{const p=state.projects.find(p=>p.id===where.id&&p.stage===where.stage);if(!p)return{count:0};Object.assign(p,data);return{count:1}}},
  product:{findMany:async()=>structuredClone(state.products.filter(p=>p.status==='RECLAMATION')),updateMany:async({data}:{data:object})=>{Object.assign(state.products[0],data);return{count:1}}},
  commercialProposal:{findMany:async()=>structuredClone(state.proposals)},proposalJob:{findMany:async()=>structuredClone(state.jobs.filter(j=>j.state==='PENDING'))},
  projectStageHistory:{create:async({data}:{data:typeof h})=>state.projects[0].stageHistory.push(data)},productStatusHistory:{create:async()=>undefined},
  changeLog:{findUnique:async({where}:{where:{id:string}})=>state.audit.find(row=>row.id===where.id)??null,create:async({data}:{data:Record<string,unknown>})=>{state.audit.push(data);return data}},
  $queryRaw:async(strings:TemplateStringsArray)=>{const sql=strings.join('');if(sql.includes('pg_control_system'))return[target.database];if(sql.includes('clock_timestamp'))return[{at:now}];if(sql.includes('pg_advisory'))return[];throw Error(sql)},
  $executeRaw:async(strings:TemplateStringsArray,...values:unknown[])=>{const sql=strings.join('');if(sql.startsWith('LOCK TABLE'))return 0;if(sql.includes('UPDATE "CommercialProposal"')){Object.assign(state.proposals[0],{acceptedVersionId:values[0],acceptedAt:null,retentionEpoch:values[2]});return 1}if(sql.includes('UPDATE "ProposalJob"')){state.jobs[0].state='CANCELLED';return 1}throw Error(sql)},
 } as unknown as Prisma.TransactionClient;
 const ports:StageRetirementPorts={transaction:async run=>{const before=structuredClone(state);try{return await run(tx)}catch(error){Object.assign(state,before);throw error}},verifyTargetAndNoOldWriters:async()=>target};
 const plan=await planStageRetirement(ports,{operationId:patch.clientMutationId,actorId:actor.id,target});
 assert.equal(state.projects[0].stage,'PAUSED');assert.equal(plan.snapshot.projects[0].toStage,'LEAD');
 const beforeMoney=structuredClone(state.money);assert.equal((await applyStageRetirement(ports,plan,plan.fingerprint)).replayed,false);
 assert.equal(state.projects[0].stage,'LEAD');assert.equal(state.products[0].status,'PRODUCTION');assert.deepEqual(state.projects[0].deletedAt,new Date(1));
 assert.deepEqual(state.projects[0].stageHistory[0],h);assert.equal(state.proposals[0].acceptedVersionId,null);assert.equal(state.proposals[0].retentionEpoch,4);assert.equal(state.jobs[0].state,'CANCELLED');assert.deepEqual(state.money,beforeMoney);
 const auditCount=state.audit.length;assert.equal((await applyStageRetirement(ports,plan,plan.fingerprint)).replayed,true);assert.equal(state.audit.length,auditCount);
 assert.equal(retiredProjectTarget('RECLAMATION',[]),'IN_WORK');assert.equal(retiredProjectTarget('PAUSED',[]),'IN_WORK');
 assert.equal(retiredProjectTarget('PAUSED',[{fromStage:'CONTRACT',toStage:'PAUSED'}]),'CONTRACT');
});
