import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
import type {Role} from '@prisma/client';
import {matches,type FixtureRow} from './helpers/visibility-fixture';
const require=createRequire(import.meta.url);
function inject(path:string,exports:Record<string,unknown>){const filename=require.resolve(path),stub=new Module(filename);stub.filename=filename;stub.loaded=true;stub.exports=exports;require.cache[filename]=stub;}
let actor:{id:string;roles:Role[]}|null={id:'actor',roles:['ACCOUNTANT']};let rows:FixtureRow[]=[],written=0;const order:string[]=[],updates:FixtureRow[]=[],queries:FixtureRow[]=[];
const db={task:{findMany:async()=>{order.push('resolve');return [];}},productPercentageParticipant:{findMany:async()=>{order.push('resolve');return[];}},timeEntry:{findMany:async({where}:{where:FixtureRow})=>{queries.push(where);return rows.filter(row=>matches(row,where));},updateMany:async({where,data}:{where:FixtureRow;data:FixtureRow})=>{order.push('update');updates.push(where);const eligible=rows.filter(row=>matches(row,where));for(const row of eligible)Object.assign(row,data);written+=eligible.length;return {count:eligible.length};},findFirst:async({where}:{where:FixtureRow})=>{queries.push(where);return rows.find(row=>matches(row,where))??null;}}};
inject('../src/auth',{auth:async()=>actor?{user:actor}:null});inject('../src/lib/prisma',{prisma:db});inject('next/cache',{revalidatePath:()=>{}});inject('../src/server/tasks/transaction',{withTaskTransaction:async(operation:(db:unknown)=>Promise<unknown>)=>operation(db)});inject('../src/server/plugins/changelog',{writeChangeLog:async()=>{}});
const {getActiveTimer}=require('../src/server/time/actions') as typeof import('../src/server/time/actions');
const {taskExecutionWhere}=require('../src/server/access/visibility') as typeof import('../src/server/access/visibility');
function containsImpossibleId(scope:FixtureRow):boolean {
 const id=scope.id as {in?:unknown[]}|undefined;
 return Array.isArray(id?.in)&&id.in.length===0 || Array.isArray(scope.AND)&&(scope.AND as FixtureRow[]).some(containsImpossibleId);
}
function fixture(roles:Role[],status='PRODUCTION'){
 actor={id:'actor',roles};written=0;updates.length=0;queries.length=0;order.length=0;
 const task=(id:string,assigneeId='actor',deleted=false)=>({id,assigneeId,productId:'product',project:{id:'project',deletedAt:deleted?new Date():null},product:{id:'product',projectId:'project',engineerId:'actor',status,deletedAt:null,project:{deletedAt:null}}});
 const expired=new Date(Date.now()-13*3600000),fresh=new Date(Date.now()-3600000);
 rows=[{id:'expired-own',userId:'actor',taskId:'own',task:task('own'),source:'timer',startedAt:expired,stoppedAt:null,minutes:0,autoStopped:false},{id:'fresh-own',userId:'actor',taskId:'fresh',task:task('fresh'),source:'timer',startedAt:fresh,stoppedAt:null,minutes:0,autoStopped:false},{id:'expired-foreign-user',userId:'other',taskId:'other',task:task('other','other'),source:'timer',startedAt:expired,stoppedAt:null,minutes:0,autoStopped:false},{id:'expired-deleted-task-parent',userId:'actor',taskId:'deleted',task:task('deleted','actor',true),source:'timer',startedAt:expired,stoppedAt:null,minutes:0,autoStopped:false}];
}
test('finance-only ACCOUNTANT and readonly PROCUREMENT inherited expired timers cannot mutate or reveal ordinary task',async()=>{
 for(const role of ['ACCOUNTANT','PROCUREMENT'] as Role[]){fixture([role]);const before=structuredClone(rows);assert.equal(await getActiveTimer(),null,role);assert.equal(written,0,role);assert.deepEqual(rows,before,role);assert.ok(updates.every(where=>'task' in where),'autostop must carry current task scope');}
});
test('denied execution uses an explicit impossible ID predicate inside real timer relation filters',async()=>{
 for(const role of ['ACCOUNTANT','PROCUREMENT'] as Role[]){
  fixture([role]);
  const scope=taskExecutionWhere({id:'actor',roles:[role]});
  assert.equal(containsImpossibleId(scope as FixtureRow),true,role);
  for(const row of rows)assert.equal(matches(row.task as FixtureRow,scope as FixtureRow),false,role+' '+row.id);
  await getActiveTimer();
  assert.ok(queries.length>0);
  for(const where of queries){assert.equal(containsImpossibleId(where.task as FixtureRow),true,role);for(const row of rows)assert.equal(matches(row.task as FixtureRow,where.task as FixtureRow),false,role+' '+row.id);}
  assert.equal(rows.find(row=>row.id==='fresh-own')?.stoppedAt,null);
 }
});
test('allowed worker timeout is limited to own live executable task; resolved scope precedes update',async()=>{
 fixture(['WORKER']);const result=await getActiveTimer();assert.equal(result?.id,'fresh-own');assert.equal(written,1);assert.equal(rows[0].minutes,720);assert.equal(rows[0].autoStopped,true);assert.ok(rows[0].stoppedAt instanceof Date);assert.equal(rows[2].stoppedAt,null);assert.equal(rows[3].stoppedAt,null);assert.ok(order.includes('resolve')&&order.indexOf('resolve')<order.indexOf('update'),'visibility must resolve before autostop');
});
test('combined union keeps engineer/worker/manager execution grants in either role order',async()=>{
 for(const roles of [['ACCOUNTANT','WORKER'],['WORKER','ACCOUNTANT'],['ACCOUNTANT','MANAGER'],['MANAGER','ACCOUNTANT'],['ACCOUNTANT','ENGINEER'],['ENGINEER','ACCOUNTANT']] as Role[][]){fixture(roles,roles.includes('ENGINEER')?'DESIGN':'PRODUCTION');const result=await getActiveTimer();assert.equal(result?.id,'fresh-own',roles.join('+'));assert.equal(written,1,roles.join('+'));assert.equal(rows[0].minutes,720);assert.equal(rows[2].stoppedAt,null);assert.equal(rows[3].stoppedAt,null);}
});
test('revoked assignment and missing auth cannot mutate existing time rows',async()=>{
 fixture(['WORKER']);(rows[0].task as FixtureRow).assigneeId='other';const before=structuredClone(rows);await getActiveTimer();assert.equal(written,0);assert.deepEqual(rows,before);
 actor=null;await assert.rejects(getActiveTimer,/Не авторизован/);assert.equal(written,0);
});
