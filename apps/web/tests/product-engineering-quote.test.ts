import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateStageFund } from "../src/lib/product-stage-pay";
import { resolveStageRates } from "../src/server/product-stage-pay/quote";
import { matches } from "./helpers/visibility-fixture";
import { type PrismaClient, type Role, Prisma } from "@prisma/client";
import { canEditProductTechnicalBlock, engineeringParticipantProductIds, productEditWhere, productVisibilityWhere, projectVisibilityWhere, resolveVisibilityActor, taskExecutionWhere } from "../src/server/access/visibility";
import { canSplitTask, engineeringRecipientError } from "../src/server/tasks/share-policy";
import { taskShareFixture, historicalTaskAllocation } from "./helpers/task-share-fixture";
import { changeTaskStatusCore } from "../src/server/tasks/completion-core";
import { captureProductPercentageCompletion } from "../src/server/product-percentage-pay/core";
import { type DomainActor } from "../src/server/projects/core";

// Источник: product-engineering-quote.test.ts
const now = new Date("2026-09-28T12:00:00.000Z");

test("1000 USD at 5 percent and rate 3 produces exactly 150 BYN", async () => {
  const calls: string[] = [];
  const quote = await resolveStageRates("USD", "BYN", now, async (currency, date) => {
    calls.push(currency); assert.equal(date?.toISOString().slice(0, 10), "2026-09-28");
    return { rate: 3, date: "2026-09-28" };
  });
  assert.deepEqual(calls, ["USD"]);
  assert.deepEqual(quote.payroll, { currency: "BYN", rate: "1.000000", date: "2026-09-28" });
  const fund = calculateStageFund({ price: "1000.00", ratePercent: "5.00", productCurrency: "USD", payrollCurrency: "BYN", productRateByn: quote.product.rate, payrollRateByn: quote.payroll.rate });
  assert.deepEqual(fund, { sourceFundExact: "50.000000", amount: "150.00", bynAmount: "150.00", projectAmount: "50.00" });
});

test("same foreign currency is fetched once and BYN never requires a network call", async () => {
  let calls = 0;
  const read = async () => { calls++; return { rate: 3.123456, date: "2026-09-28" }; };
  const quote = await resolveStageRates("USD", "USD", now, read);
  assert.equal(calls, 1);
  assert.deepEqual(quote.product, quote.payroll);
  await resolveStageRates("BYN", "BYN", now, read);
  assert.equal(calls, 1);
});

test("unsupported currency is rejected before any provider call", async () => {
  let calls = 0;
  await assert.rejects(resolveStageRates("GBP", "BYN", now, async () => { calls++; return { rate: 3, date: "2026-09-28" }; }), /валют/);
  assert.equal(calls, 0);
});

test("missing, zero, non-finite, overprecision and overflowing rates are rejected", async () => {
  for (const rate of [undefined, null, 0, -1, NaN, Infinity, 0.1234567, 1e12]) {
    await assert.rejects(resolveStageRates("USD", "BYN", now, async () => ({ rate: rate as number, date: "2026-09-28" })), /курс/i, String(rate));
  }
});

test("invalid or future rate dates are rejected without replacing currencies", async () => {
  for (const date of ["", "2026-02-30", "2026-09-29", "2026-09-28T00:00:00"])
    await assert.rejects(resolveStageRates("USD", "BYN", now, async () => ({ rate: 3, date })), /дат/i, date);
});

test("provider timeout fails the entire quote, without amount or BYN fallback", async () => {
  await assert.rejects(resolveStageRates("USD", "EUR", now, async (currency) => {
    if (currency === "EUR") throw new Error("timeout");
    return { rate: 3, date: "2026-09-28" };
  }), /получить курс/i);
});

// Источник: product-engineering-access.test.ts
function dbFor(rows: Array<{ id: string; productId: string | null; projectId: string; product: { projectId: string } | null; work: { productId: string | null; projectId: string } | null }>) {
  return { task: { findMany: async () => rows } } as unknown as Pick<PrismaClient, "task">;
}

test("participant resolver accepts zero-share assignment and rejects every mismatched link", async () => {
  const valid = { id: "valid", productId: "p", projectId: "project", product: { projectId: "project" }, work: { productId: "p", projectId: "project" } };
  const db = dbFor([
    valid,
    { ...valid, productId: "other" },
    { ...valid, product: { projectId: "other" } },
    { ...valid, work: { productId: "other", projectId: "project" } },
    { ...valid, work: { productId: "p", projectId: "other" } },
    { ...valid, work: null },
  ]);
  const actor = await resolveVisibilityActor(db, { id: "u", roles: ["ENGINEER"] });
  assert.deepEqual(actor.engineeringParticipantProductIds, ["p"]);
  assert.deepEqual(actor.engineeringParticipantTaskIds, ["valid"]);
  assert.deepEqual(await engineeringParticipantProductIds(db, "u", false), ["p"]);
  assert.equal(canEditProductTechnicalBlock(actor, { id: "p", engineerId: null, status: "DESIGN" }), true);
  assert.equal(canEditProductTechnicalBlock(actor, { id: "p", engineerId: null, status: "PRODUCTION" }), false);
  assert.equal(canEditProductTechnicalBlock({ id: "u", roles: [] }, { id: "p", engineerId: null, status: "DESIGN" }), false);
});

test("participant predicates remain DESIGN scoped; independent manager and field grants survive", () => {
  const participant = { id: "u", roles: ["ENGINEER"] as Role[], engineeringParticipantProductIds: ["p"], engineeringParticipantTaskIds: ["task"] };
  const row={id:"p",engineerId:null,status:"DESIGN",deletedAt:null,project:{deletedAt:null}};
  assert.equal(matches(row,productEditWhere(participant)),true);
  for(const patch of [{status:"DRAFT"},{status:"PRODUCTION"},{id:"foreign"}])assert.equal(matches({...row,...patch},productEditWhere(participant)),false);
  const read = JSON.stringify(productVisibilityWhere(participant));
  assert.match(read, /DESIGN/);
  assert.match(read, /engineerId/);
  assert.match(read, /"p"/);
  const execution = JSON.stringify(taskExecutionWhere(participant));
  assert.match(execution, /"task"/);
  assert.match(execution, /DESIGN/);
  assert.equal(matches(row,productEditWhere({id:"u",roles:["MANAGER"]})),true);
  assert.equal(matches({...row,status:"DRAFT"},productEditWhere({id:"u",roles:["MANAGER"]})),false);
  const field = JSON.stringify(productVisibilityWhere({ id: "u", roles: ["WORKER"] }));
  assert.match(field, /assigneeId/);
  assert.match(field, /"in":\["PRODUCTION","STORAGE"\]/);
  for(const status of ["DRAFT","PREPARATION","DESIGN","PRODUCTION"])assert.equal(matches({...row,status},productVisibilityWhere({id:"u",roles:[]})),false,status);
});

test("legacy ENGINEERING recipient facts remain readable but no new split is offered", () => {
  const product = { engineerId: "primary", status: "DESIGN" as const };
  assert.notEqual(engineeringRecipientError({ id: "u", roles: [], active: true }, product), null);
  assert.notEqual(engineeringRecipientError({ id: "u", roles: ["ACCOUNTANT"], active: true }, product), null);
  assert.equal(engineeringRecipientError({ id: "u", roles: ["WORKER"], active: true }, product), null);
  assert.match(engineeringRecipientError({ id: "u", roles: [], active: false }, product) ?? "", /неактивен/);
  assert.equal(canSplitTask({ id: "u", roles: [] }, { assigneeId: "u", status: "NEW", product, paidCount: 0, work: { paymentKind: "ENGINEERING" } }), false);
  assert.equal(canSplitTask({ id: "u", roles: [] }, { assigneeId: "u", status: "DONE", product, paidCount: 0, work: { paymentKind: "ENGINEERING" } }), false);
  assert.equal(canSplitTask({ id: "u", roles: [] }, { assigneeId: "u", status: "NEW", product, paidCount: 1, work: { paymentKind: "ENGINEERING" } }), false);
});

test("direct participant grants are stage-scoped; pure field cannot see DESIGN sibling", async () => {
  const db = { task: { findMany: async () => [] }, productPercentageParticipant: {
    findMany: async ({ where }: { where: { config: { kind: string } } }) =>
      [{ config: { productId: where.config.kind === "ENGINEERING" ? "design-own" : "install-own" } }],
  } } as unknown as Pick<PrismaClient, "task" | "productPercentageParticipant">;
  const engineer = await resolveVisibilityActor(db, { id: "e", roles: ["ENGINEER"] });
  assert.deepEqual(engineer.engineeringParticipantProductIds, ["design-own"]);
  assert.match(JSON.stringify(productVisibilityWhere(engineer)), /design-own/);
  assert.match(JSON.stringify(productVisibilityWhere(engineer)), /engineerId/);
  const mounter = await resolveVisibilityActor(db, { id: "m", roles: ["MOUNTER"] });
  assert.deepEqual(mounter.fieldParticipantProductIds, ["install-own"]);
  const product = JSON.stringify(productVisibilityWhere(mounter));
  assert.match(product, /install-own/);
  assert.match(product, /"in":\["INSTALLATION"\]/);
  const project = JSON.stringify(projectVisibilityWhere(mounter));
  assert.match(project, /"products"/);
  assert.match(project, /"none":\{\}/);
});

{ // Источник: combined-engineering-compensation.test.ts
const manager:DomainActor={id:'manager',name:'Manager',roles:['MANAGER'],source:'web'};
type Row=Record<string,unknown>;
function combinedFixture(roles:Role[],payScheme:string){
 const fixture=taskShareFixture('DESIGN');
 const recipient=fixture.state().users.find(row=>row.id==='worker')!;Object.assign(recipient,{roles,payScheme});
 fixture.state().products[0].engineerId='worker';
 const snapshots:Row[]=[],shares:Row[]=[];
 let price='1000.01',rate='5';
 const capture=()=>fixture.transaction(async tx=>{
 const percentageTx={...tx,
 product:{findUnique:async()=>({id:'product',projectId:'project',number:'1.1',status:fixture.state().products[0].status,quantity:3,expectedPrice:new Prisma.Decimal(price),project:{currency:fixture.state().projectCurrency},engineer:recipient,percentageConfigs:[{revision:1,ratePercent:new Prisma.Decimal(rate)}],stagePayPools:[]})},
 productPercentageCompletion:{findUnique:async()=>snapshots[0]??null,create:async({data}:{data:Row})=>{const row={id:'completion',...data};snapshots.push(row);return row;}},
 productPercentageCompletionShare:{create:async({data}:{data:Row})=>{const row={id:'percentage-share',...data};shares.push(row);return row;}},
 } as unknown as Prisma.TransactionClient;
 return captureProductPercentageCompletion(percentageTx,manager,'product','ENGINEERING','PRODUCTION');
 });
 return {fixture,snapshots,shares,capture,changePriceAndRate:()=>{price='9999';rate='90';}};
}
test('ENGINEER+MANAGER chosen PIECE plus independent engineering percentage in either role order, with exact snapshots/replay',async()=>{
 for(const roles of [['ENGINEER','MANAGER'],['MANAGER','ENGINEER']] as Role[][]){
 const f=combinedFixture(roles,'PIECE');
 const result=await changeTaskStatusCore(manager,'source','DONE',undefined,f.fixture.transaction);
 assert.ok(result.ok);assert.equal(result.payroll?.amount,'1000.00');
 assert.equal(await f.capture(),'SETTLED');
 const entries=f.fixture.state().entries;
 assert.deepEqual(entries.map(row=>[row.scheme,row.amount,row.currency]),[['PIECE','1000.00','BYN'],['PRODUCT_PERCENT_ENGINEERING','51.00','BYN']]);
 assert.ok(entries.every(row=>row.userId==='worker'));assert.equal(f.snapshots[0].calculationVersion,4);assert.equal(f.snapshots[0].quantitySnapshot,3);
 assert.equal(String(f.snapshots[0].totalSnapshot),'3000.03');assert.equal(String(f.snapshots[0].ratePercentSnapshot),'5');
 const immutable=JSON.stringify({entries,snapshots:f.snapshots,shares:f.shares});
 f.changePriceAndRate();assert.equal(await f.capture(),'SETTLED');
 const again=await changeTaskStatusCore(manager,'source','DONE',undefined,f.fixture.transaction);assert.ok(again.ok&&again.repeated);
 assert.equal(JSON.stringify({entries:f.fixture.state().entries,snapshots:f.snapshots,shares:f.shares}),immutable);
 assert.equal(entries.filter(row=>row.scheme==='PERCENT_PROJECT').length,0);
 assert.equal(f.fixture.state().users.find(row=>row.id==='worker')!.payScheme,'PIECE');
 }
});
test('engineering percentage remains independent of chosen NONE or TURNOVER scheme, without synthetic task PIECE',async()=>{
 for(const payScheme of ['NONE','PERCENT_TURNOVER']){
 const f=combinedFixture(['ENGINEER','MANAGER'],payScheme);
 const result=await changeTaskStatusCore(manager,'source','DONE',undefined,f.fixture.transaction);assert.ok(result.ok);assert.equal(result.payroll,null);
 assert.equal(await f.capture(),'SETTLED');assert.deepEqual(f.fixture.state().entries.map(row=>row.scheme),['PRODUCT_PERCENT_ENGINEERING']);
 assert.equal(f.fixture.state().entries[0].amount,'51.00');assert.equal(f.fixture.state().users.find(row=>row.id==='worker')!.payScheme,payScheme);
 }
});
test('combined role does not weaken photo/dependency/currency or produce engineering payment on malformed source',async()=>{
 const missingPhoto=combinedFixture(['ENGINEER','MANAGER'],'PIECE');missingPhoto.fixture.state().files.length=0;
 const before=structuredClone(missingPhoto.fixture.state());assert.equal((await changeTaskStatusCore(manager,'source','DONE',undefined,missingPhoto.fixture.transaction)).ok,false);assert.deepEqual(missingPhoto.fixture.state(),before);
 const foreign=combinedFixture(['ENGINEER','MANAGER'],'PIECE');foreign.fixture.state().projectCurrency='USD';await assert.rejects(foreign.capture(),/BYN/);assert.equal(foreign.fixture.state().entries.length,0);assert.equal(foreign.snapshots.length,0);
});

test('pure ENGINEER does not accrue a new ordinary PIECE but keeps product engineering snapshot',async()=>{
 const f=combinedFixture(['ENGINEER'],'PIECE');
 f.fixture.state().entries.push({id:'old-pay',userId:'worker',scheme:'PIECE',amount:'12.34',bynAmount:'12.34',currency:'BYN',month:'2000-01'});
 const history=JSON.stringify(f.fixture.state().entries);
 const result=await changeTaskStatusCore(manager,'source','DONE',undefined,f.fixture.transaction);assert.ok(result.ok);assert.equal(result.payroll,null);
 assert.equal(JSON.stringify(f.fixture.state().entries),history);
 assert.equal(await f.capture(),'SETTLED');assert.equal(f.fixture.state().entries.at(-1)?.scheme,'PRODUCT_PERCENT_ENGINEERING');
 assert.equal(f.fixture.state().entries.at(-1)?.amount,'51.00');
});

test('pure ENGINEER keeps valid old TASK_FIXED monetary obligation unchanged despite changed/null current unit price',async()=>{
 for(const priceSnapshot of ['9999.99',null]){
 const f=combinedFixture(['ENGINEER'],'PIECE');historicalTaskAllocation(f.fixture);
 f.fixture.state().works[0].priceSnapshot=priceSnapshot;
 const frozen=JSON.stringify({group:f.fixture.state().groups[0],shareAmount:f.fixture.state().tasks[0].shareAmount,shareUnits:f.fixture.state().tasks[0].shareUnits});
 const result=await changeTaskStatusCore(manager,'source','DONE',undefined,f.fixture.transaction);assert.ok(result.ok);assert.equal(result.payroll?.amount,'700.00');
 assert.deepEqual(f.fixture.state().entries.map(row=>[row.scheme,row.amount]),[['PIECE','700.00']]);
 assert.equal(JSON.stringify({group:f.fixture.state().groups[0],shareAmount:f.fixture.state().tasks[0].shareAmount,shareUnits:f.fixture.state().tasks[0].shareUnits}),frozen);
 assert.ok((await changeTaskStatusCore(manager,'source','DONE',undefined,f.fixture.transaction)).ok);assert.equal(f.fixture.state().entries.length,1);
 }
});
test('pure ENGINEER is not granted ordinary salary by physical/stage/corrupted/nonmonetary legacy markers',async()=>{
 for(const mode of ['physical','preview','missing-budget','invalid-money','over-budget','bad-units','wrong-work','group-only','coefficient-only']){
 const f=combinedFixture(['ENGINEER'],'PIECE');historicalTaskAllocation(f.fixture);const task=f.fixture.state().tasks[0],group=f.fixture.state().groups[0];
 if(mode==='physical'){group.budgetSource='PHYSICAL_ONLY';task.physicalOnlyShare=true;}
 if(mode==='preview')group.budgetSource='STAGE_PREVIEW';if(mode==='missing-budget')group.budget=null;
 if(mode==='invalid-money')task.shareAmount='NaN';if(mode==='over-budget')task.shareAmount='1000.01';if(mode==='bad-units')task.shareUnits=0;
 if(mode==='wrong-work')group.workId='foreign';if(mode==='group-only')task.shareAmount=null;
 if(mode==='coefficient-only'){task.allocationGroupId=null;task.shareAmount=null;task.shareUnits=null;task.executorShare='0.5';}
 const result=await changeTaskStatusCore(manager,'source','DONE',undefined,f.fixture.transaction);assert.ok(result.ok,mode);assert.equal(result.payroll,null,mode);assert.equal(f.fixture.state().entries.length,0,mode);
 }
});
test('existing historical PIECE entry is neither recalculated nor duplicated when old obligation finishes',async()=>{
 const f=combinedFixture(['ENGINEER'],'PIECE');historicalTaskAllocation(f.fixture);
 f.fixture.state().entries.push({id:'paid-before',userId:'worker',taskId:'source',scheme:'PIECE',amount:'700.00',bynAmount:'700.00',currency:'BYN',month:'2000-01'});
 const original=JSON.stringify(f.fixture.state().entries);const result=await changeTaskStatusCore(manager,'source','DONE',undefined,f.fixture.transaction);
 assert.ok(result.ok);assert.equal(result.payroll,null);assert.equal(JSON.stringify(f.fixture.state().entries),original);
});
}

{ // Источник: product-engineering-completion.test.ts
const manager: DomainActor = { id: "manager", name: "Manager", roles: ["MANAGER"], source: "web" };

test("ENGINEERING completion never pays PIECE, regardless of recipient role or old price", async () => {
  for (const role of ["ENGINEER", "WORKER", "MOUNTER", "ACCOUNTANT", "MANAGER", "ADMIN", "DIRECTOR"]) {
    const fixture = taskShareFixture("DESIGN");
    Object.assign(fixture.state().works[0], { paymentKind: "ENGINEERING", stagePayPoolId: "pool", poolWeightUnits: 1_000_000 });
    fixture.state().tasks[0].stageShareUnits = 1_000_000;
    fixture.state().users.find((user) => user.id === "worker")!.roles = [role];
    const originalTime = structuredClone(fixture.state().times);
    const result = await changeTaskStatusCore(manager, "source", "DONE", undefined, fixture.transaction);
    assert.ok(result.ok, role);
    assert.equal(result.payroll, null, role);
    assert.equal(fixture.state().entries.length, 0, role);
    assert.equal(fixture.state().tasks[0].status, "DONE", role);
    assert.deepEqual(fixture.state().times, originalTime, role);
  }
});

test("a new ENGINEERING Work with no legacy monetary snapshot can finish", async () => {
  const fixture = taskShareFixture("DESIGN");
  Object.assign(fixture.state().works[0], { paymentKind: "ENGINEERING", stagePayPoolId: "pool", priceSnapshot: null, total: null });
  fixture.state().tasks[0].stageShareUnits = 1_000_000;
  const result = await changeTaskStatusCore(manager, "source", "DONE", undefined, fixture.transaction);
  assert.ok(result.ok);
  assert.equal(result.payroll, null);
  assert.equal(fixture.state().entries.length, 0);
});

test("zero-funded engineering work retains photo requirements", async () => {
  const fixture = taskShareFixture("DESIGN");
  Object.assign(fixture.state().works[0], { paymentKind: "ENGINEERING", stagePayPoolId: "pool", poolWeightUnits: 0 });
  fixture.state().tasks[0].stageShareUnits = 0;
  fixture.state().files.length = 0;
  const before = structuredClone(fixture.state());
  const result = await changeTaskStatusCore(manager, "source", "DONE", undefined, fixture.transaction);
  assert.equal(result.ok, false);
  assert.deepEqual(fixture.state(), before);
});

test("a LEGACY Work named engineering keeps its ordinary piece payment", async () => {
  const fixture = taskShareFixture("DESIGN");
  Object.assign(fixture.state().works[0], { paymentKind: "LEGACY", title: "Проектирование" });
  const result = await changeTaskStatusCore(manager, "source", "DONE", undefined, fixture.transaction);
  assert.ok(result.ok);
  assert.equal(result.payroll?.amount, "1000.00");
  assert.equal(fixture.state().entries.length, 1);
});

test("duplicate engineering completion leaves one status event and no PIECE", async () => {
  const fixture = taskShareFixture("DESIGN");
  Object.assign(fixture.state().works[0], { paymentKind: "ENGINEERING", stagePayPoolId: "pool" });
  const complete = () => changeTaskStatusCore(manager, "source", "DONE", undefined, fixture.transaction);
  const results = await Promise.all([complete(), complete()]);
  assert.ok(results.every((result) => result.ok));
  assert.equal(fixture.state().entries.length, 0);
  assert.equal(fixture.state().events.length, 1);
  assert.equal(fixture.state().pools[0].revision, 1);
});

test("ENGINEERING completion rejects settled pool and inconsistent task/work context atomically", async () => {
  for (const mismatch of ["settled", "work-project", "pool-product"]) {
    const fixture = taskShareFixture("DESIGN");
    Object.assign(fixture.state().works[0], { paymentKind: "ENGINEERING", stagePayPoolId: "pool" });
    fixture.state().tasks[0].stageShareUnits = 1_000_000;
    if (mismatch === "settled") fixture.state().pools[0].state = "SETTLED";
    if (mismatch === "work-project") fixture.state().works[0].projectId = "other";
    if (mismatch === "pool-product") fixture.state().pools[0].productId = "other";
    const before = structuredClone(fixture.state());
    const result = await changeTaskStatusCore(manager, "source", "DONE", undefined, fixture.transaction);
    assert.equal(result.ok, false, mismatch);
    assert.deepEqual(fixture.state(), before, mismatch);
  }
});
}
