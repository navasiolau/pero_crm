import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileFunction} from 'node:vm';
import {test} from 'node:test';
import {Prisma} from '@prisma/client';
import ts from 'typescript';
import type {DomainActor} from '../src/server/actor';

// Загружаем сам guard, не запускаем before-hook PostgreSQL fixture и не заменяем его реализацию.
const source=ts.createSourceFile('domain-postgres.test.ts',readFileSync(new URL('./integration/domain-postgres.test.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const declaration=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='mutationTx');
assert.ok(declaration,'NATIVE_MUTATION_GUARD_REQUIRED');
const compiled=ts.transpileModule(declaration.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
type Probe={actor:DomainActor;taskId:string;workerId:string;workId:string;projectId:string;payrollId?:string;receiptId:string;payment:boolean;
  calls:number;writes:number;partials:number;effects:string[];connections:unknown[];owned:Record<string,string[]>;creates:Set<string>;mode?:'failed-proof'};
const mutationTx=compileFunction(`${compiled}\nreturn mutationTx;`,['assert'])(assert) as (tx:Prisma.TransactionClient,probe:Probe,proof:boolean)=>Prisma.TransactionClient;

function fixture(proof=false){
  const probe:Probe={actor:{id:'actor',name:'Оператор',roles:['WORKER'],source:'web'},taskId:'task',workerId:'worker',workId:'work',projectId:'project',receiptId:'receipt',payment:false,
    calls:0,writes:0,partials:0,effects:[],connections:[],owned:{User:['actor','worker'],Work:['work','other-owned-work'],Product:['product']},creates:new Set()};
  const reads:unknown[][]=[],writes:string[]=[];
  const database={$queryRaw:async(...args:unknown[])=>{reads.push(args);return[];},
    task:{update:async()=>{writes.push('task');return{id:'task'};}},
    payrollEntry:{create:async()=>{writes.push('payroll');return{id:'own-payroll'};}},
    changeLog:{create:async()=>{writes.push('audit');return{id:'own-audit'};},findUnique:async()=>null},
  } as unknown as Prisma.TransactionClient;
  return{probe,reads,writes,guard:mutationTx(database,probe,proof)};
}

test('native mutation guard разрешает только exact Work/current User metadata reads и прежний lock',async()=>{
  const f=fixture();
  await f.guard.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(18435, 55001)`;
  await f.guard.$queryRaw`SELECT id,title FROM "Work" WHERE id=${f.probe.workId}`;
  await f.guard.$queryRaw(Prisma.sql`SELECT id,name FROM "User" WHERE id IN (${f.probe.actor.id})`);
  assert.equal(f.reads.length,3);assert.equal(f.writes.length,0);
  for(const query of [Prisma.sql`SELECT id,title FROM "Work" WHERE id=${'foreign'}`,
    Prisma.sql`SELECT id,title FROM "Work" WHERE id=${'other-owned-work'}`,
    Prisma.sql`SELECT id,name FROM "User" WHERE id IN (${'worker'})`,
    Prisma.sql`SELECT id,name FROM "User" WHERE id IN (${Prisma.join(['actor','worker'])})`,
    Prisma.sql`SELECT id,number FROM "Product" WHERE id=${'product'}`,
    Prisma.sql`SELECT id,title FROM "Work" WHERE id=${'work'} OR TRUE`,
    Prisma.sql`SELECT id,title FROM "Work" WHERE id=${'work'}; DELETE FROM "Work"`]){
    assert.throws(()=>f.guard.$queryRaw(query),/CI133_WRITE_STOP/);
  }
  f.probe.payment=true;assert.throws(()=>f.guard.$queryRaw`SELECT id,title FROM "Work" WHERE id=${'work'}`,/CI133_WRITE_STOP/);
  assert.equal(f.reads.length,3,'Запрещённый запрос не передаётся в DB delegate');
});

const payroll=()=>({userId:'worker',taskId:'task',workId:'work',projectId:'project',scheme:'PIECE' as const,currency:'BYN',amount:'100.00',bynAmount:'100.00',month:'2026-12'});
const audit=()=>({actorType:'user',actorId:'actor',source:'web',entity:'payrollEntry',entityId:'own-payroll',action:'accrue',
  newValue:{userId:'worker',taskId:'task',workId:'work',projectId:'project',scheme:'PIECE',currency:'BYN',amount:'100',bynAmount:'100'},
  presentation:{actor:{type:'system'},initiator:{id:'actor'},contexts:[{kind:'product',id:'product'}]}});

test('payroll audit допускается только после fenced create и для его ID, суммы, actor и System presentation',async()=>{
  const f=fixture();
  await assert.rejects(()=>f.guard.changeLog.create({data:audit()}),{code:'ERR_ASSERTION'});
  assert.equal(f.writes.length,0);
  await f.guard.payrollEntry.create({data:payroll()});
  assert.equal(f.probe.payrollId,'own-payroll');assert.deepEqual(f.probe.owned.PayrollEntry,['own-payroll']);
  for(const changed of [{...audit(),entityId:'foreign'}, {...audit(),action:'update'}, {...audit(),actorId:'foreign'},
    {...audit(),newValue:{...audit().newValue,taskId:'foreign'}}, {...audit(),newValue:{...audit().newValue,amount:'200'}},
    {...audit(),presentation:{...audit().presentation,actor:{type:'user'}}},
    {...audit(),presentation:{...audit().presentation,contexts:[{kind:'project',id:'project'}]}}]){
    await assert.rejects(()=>f.guard.changeLog.create({data:changed}),{code:'ERR_ASSERTION'});
  }
  assert.deepEqual(f.writes,['payroll']);
  await f.guard.changeLog.create({data:audit()});assert.deepEqual(f.writes,['payroll','audit']);
  assert.deepEqual(f.probe.owned.ChangeLog,['own-audit'],'Cleanup manifest получает ID только фактически созданного аудита');
  await assert.rejects(()=>f.guard.changeLog.create({data:audit()}),/CI133_WRITE_STOP/);
  assert.deepEqual(f.writes,['payroll','audit']);
});

test('proof transaction остаётся read-only и failed-proof injection не обходится metadata reads',async()=>{
  const f=fixture(true);
  await f.guard.$queryRaw`SELECT id,title FROM "Work" WHERE id=${f.probe.workId}`;
  await assert.rejects(()=>f.guard.task.update({where:{id:'task'},data:{status:'DONE'}}),/PROOF_TRANSACTION_MUST_BE_READ_ONLY/);
  await assert.rejects(()=>f.guard.payrollEntry.create({data:payroll()}),/PROOF_TRANSACTION_MUST_BE_READ_ONLY/);
  await assert.rejects(()=>f.guard.changeLog.create({data:audit()}),/PROOF_TRANSACTION_MUST_BE_READ_ONLY/);
  f.probe.mode='failed-proof';await assert.rejects(()=>f.guard.changeLog.findUnique({where:{id:'receipt'}}),/CI133_INJECTED_PROOF_READ/);
  assert.equal(f.writes.length,0);assert.equal(f.probe.writes,0);
});
