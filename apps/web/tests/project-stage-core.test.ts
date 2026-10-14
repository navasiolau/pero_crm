import assert from "node:assert/strict";
import { test } from "node:test";
import { type Prisma } from "@prisma/client";
import { patchProjectStageTransaction } from "../src/server/projects/stage-core";
import { projectStagePatchSchema, validateStageExtras } from "../src/server/projects/stage-contract";

// Источник: project-stage-core.test.ts
const actor={id:'m',name:'Менеджер',roles:['MANAGER' as const],source:'web' as const};
const patch={projectId:'p',expectedStage:'LEAD',toStage:'REFUSED',clientMutationId:'b5428289-23f7-4e42-a967-212da990d141'};
function fixture(){
 const state={project:{id:'p',stage:'LEAD',number:'П1',title:'Заказ',refusalReason:null as string|null},audit:[] as Record<string,unknown>[],history:[] as unknown[],events:[] as unknown[],locks:0,fail:false};
 const tx={$queryRaw:async()=>{state.locks++;return[]},project:{findUnique:async()=>({...state.project}),updateMany:async({where,data}:{where:{stage:string};data:Record<string,unknown>})=>{if(state.project.stage!==where.stage)return{count:0};Object.assign(state.project,data);return{count:1}}},changeLog:{findUnique:async({where}:{where:{id:string}})=>state.audit.find(x=>x.id===where.id)??null,create:async({data}:{data:Record<string,unknown>})=>{state.audit.push(data);return data}},projectStageHistory:{create:async({data}:{data:unknown})=>{state.history.push(data)}},domainEvent:{create:async({data}:{data:unknown})=>{if(state.fail)throw Error('outbox');state.events.push(data);return{id:'event'}}}} as unknown as Prisma.TransactionClient;
 const run=async(input:unknown,who=actor)=>{const before=structuredClone(state);try{return(await patchProjectStageTransaction(who,input,tx)).result}catch(error){Object.assign(state,before);throw error}};
 return{state,run};
}
test('missing refusal/reclamation details reject before all stage writes',async()=>{
 const f=fixture();for(const toStage of ['REFUSED','RECLAMATION']){assert.equal((await f.run({...patch,toStage})).kind,'validation');assert.equal(f.state.project.stage,'LEAD');assert.equal(f.state.audit.length+f.state.history.length+f.state.events.length,0)}
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
