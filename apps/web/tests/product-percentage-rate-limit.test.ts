import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { acceptsPercentageDraft, parsePercentageInput, stepPercentageDraft } from "../src/lib/percentage-rate-input";
import { parsePercentageRate, transferOwnPercentageShare } from "../src/lib/product-percentage-pay";
import { defaultsPatchSchema, defaultsSnapshotSchema, EMPTY_DEFAULTS } from "../src/server/product-percentage-defaults/contracts";
import { singleProductPercentagePreview } from "../src/lib/single-product-percentage-ui";
import { createSinglePercentageControllers } from "../src/lib/single-percentage-controller";
import { type ProductPercentagePatch, type ProductPercentagePatchResult } from "../src/server/product-percentage-pay/contracts";
import { Prisma } from "@prisma/client";
import { changeTaskStatusCore } from "../src/server/tasks/completion-core";
import { taskShareFixture } from "./helpers/task-share-fixture";

// Источник: product-percentage-rate-limit.test.ts
test("product input accepts 15, NULL and zero but refuses typed/pasted values above 15", () => {
  for (const value of ["", "0", "0.05", "5.05", "14.99", "15", "15.00"]) assert.equal(acceptsPercentageDraft(value), true);
  for (const value of ["15.01", "15.1", "16", "100"]) {
    assert.equal(acceptsPercentageDraft(value), false);
    assert.throws(() => parsePercentageInput(value), /15/);
  }
  assert.equal(parsePercentageInput(""), null);
  assert.equal(parsePercentageInput("0"), "0.00");
  assert.equal(parsePercentageInput("15"), "15.00");
});
test("arrows stop at 15 and repair a previously stored higher rate", () => {
  assert.equal(stepPercentageDraft("15", 1), "15");
  assert.equal(stepPercentageDraft("14.99", 1), "15");
  assert.equal(stepPercentageDraft("100", -1), "15");
  assert.equal(stepPercentageDraft("100", 1), "15");
});
test("new defaults are bounded; old snapshot/CAS baselines can still be repaired", () => {
  const historical = { revision: 3, rates: { ENGINEERING: "100", ASSEMBLY: "20", INSTALLATION: "16" } };
  assert.equal(defaultsSnapshotSchema.safeParse(historical).success, true);
  for (const kind of ["ENGINEERING", "ASSEMBLY", "INSTALLATION"] as const) {
    assert.equal(defaultsPatchSchema.safeParse({ rates: { ...EMPTY_DEFAULTS.rates, [kind]: "15.1" }, expectedRates: EMPTY_DEFAULTS.rates, expectedRevision: 0, clientMutationId: randomUUID() }).success, false);
  }
  assert.equal(defaultsPatchSchema.safeParse({ rates: { ENGINEERING: "15", ASSEMBLY: "15", INSTALLATION: "15" }, expectedRates: historical.rates, expectedRevision: 3, clientMutationId: randomUUID() }).success, true);
});
test("generic historical rates and own-share transfers retain the original 100% range", () => {
  assert.equal(parsePercentageRate("100"), "100.00");
  assert.deepEqual(transferOwnPercentageShare([{ userId: "a", shareUnits: 1_000_000 }], "a", "b", "100"), [{ userId: "b", shareUnits: 1_000_000 }]);
});

// Источник: product-percentage-ceil.test.ts
const draft = { state: "DRAFT", version: 4, unitPrice: "19986.00", quantity: 1, rate: "5", frozenTotal: null, recipientEligible: true } as const;
for (const kind of ["ENGINEERING", "ASSEMBLY", "INSTALLATION"] as const) {
  test(`${kind}: v4 ceiling uses the exact result, including sub-cent values`, () => {
    const preview = (unitPrice: string, rate: string) => singleProductPercentagePreview({ ...draft, kind, unitPrice, rate });
    assert.equal(preview("19986.00", "5"), "1000.00");
    assert.equal(preview("1000", "5"), "50.00");
    assert.equal(preview("0.01", "1"), "1.00");
    assert.equal(preview("0", "5"), "0.00");
    assert.equal(preview("999.30", "0"), "0.00");
  });
  test(`${kind}: v4 keeps unit engineering and batch assembly/installation`, () => {
    assert.equal(singleProductPercentagePreview({ ...draft, kind, unitPrice: "1000", quantity: 3, rate: kind === "ENGINEERING" ? "5" : kind === "ASSEMBLY" ? "4" : "7" }),
      kind === "ENGINEERING" ? "50.00" : kind === "ASSEMBLY" ? "120.00" : "210.00");
  });
}
test("v4: NULL, invalid input and rounded overflow stay unavailable; zero is explicit", () => {
  const row = { ...draft, kind: "ENGINEERING" as const };
  assert.equal(singleProductPercentagePreview({ ...row, unitPrice: null }), null);
  assert.equal(singleProductPercentagePreview({ ...row, rate: null }), null);
  assert.equal(singleProductPercentagePreview({ ...row, quantity: null }), null);
  assert.equal(singleProductPercentagePreview({ ...row, rate: "101" }), null);
  assert.equal(singleProductPercentagePreview({ ...row, kind: "ASSEMBLY", quantity: 8, rate: "15", unitPrice: "8333333332.51" }), null);
  assert.equal(singleProductPercentagePreview({ ...row, rate: "15", unitPrice: "9999999999.00" }), "1500000000.00");
  assert.equal(singleProductPercentagePreview({ ...row, unitPrice: null, rate: "0" }), "0.00");
});
test("existing versions and frozen v4 totals are never repriced", () => {
  for (const version of [1, 2, 3] as const) {
    const row = { ...draft, version, kind: "ENGINEERING" as const };
    assert.equal(singleProductPercentagePreview(row), "999.30");
    assert.equal(singleProductPercentagePreview({ ...row, state: "SETTLED", frozenTotal: "999.30", unitPrice: "1" }), "999.30");
  }
  assert.equal(singleProductPercentagePreview({ ...draft, kind: "ENGINEERING", state: "SETTLED", frozenTotal: "1000.00", unitPrice: "1" }), "1000.00");
});

// Источник: percentage-rate-input.test.ts
test('ASCII input rejects exponent/sign/comma/whitespace/third decimal and preserves NULL/zero',()=>{
 for(const bad of ['1e2','1E2','+1','-1','5,1',' 5','5 ','1.123','１２','1..2']){assert.equal(acceptsPercentageDraft(bad),false);assert.throws(()=>parsePercentageInput(bad));}
 assert.equal(parsePercentageInput(''),null);assert.equal(parsePercentageInput('0'),'0.00');assert.equal(parsePercentageInput('5.05'),'5.05');assert.throws(()=>parsePercentageInput('100.01'));
});
test('integer hundredths give exact 0.5 steps, retain hundredth precision and clamp endpoints',()=>{
 assert.equal(stepPercentageDraft('5.05',1),'5.55');assert.equal(stepPercentageDraft('5.05',-1),'4.55');assert.equal(stepPercentageDraft('99.95',1),'15');assert.equal(stepPercentageDraft('0.05',-1),'0');assert.equal(stepPercentageDraft('',1),'0.5');assert.equal(stepPercentageDraft('',-1),'0');assert.equal(stepPercentageDraft('5.',1),'5.5');assert.equal(stepPercentageDraft('.',1),null);
 let value='0';for(let i=0;i<200;i++)value=stepPercentageDraft(value,1)!;assert.equal(value,'15');for(let i=0;i<200;i++)value=stepPercentageDraft(value,-1)!;assert.equal(value,'0');

});
const saved=(input:ProductPercentagePatch):ProductPercentagePatchResult=>({ok:true,kind:'saved',field:input.field,value:input.value,revision:input.expectedRevision+1,clientMutationId:input.clientMutationId,noOp:false,repeated:false});
test('stepped dirty draft retains CAS/UUID after lost ACK and does not save invalid comma',async()=>{
 const calls:ProductPercentagePatch[]=[];let lost=true;
 const group=createSinglePercentageControllers({productId:'p',kind:'ENGINEERING',initial:{ratePercent:'5',assigneeId:'e'},revision:4,save:async input=>{calls.push(input);if(lost)throw Error('lost ACK');return saved(input);}});
 const rate=group.controllers.ratePercent;rate.setDraft('5.05');rate.setDraft(stepPercentageDraft(rate.getSnapshot().draft,1)!);assert.equal(await rate.commit(),false);assert.equal(calls[0].expectedValue,'5');assert.equal(calls[0].value,'5.55');assert.equal(calls[0].expectedRevision,4);lost=false;assert.equal(await rate.retry(),true);assert.deepEqual(calls[0],calls[1]);
  rate.setDraft('5,25');assert.equal(await rate.commit(),false);assert.equal(calls.length,2);rate.setDraft('');assert.equal(await rate.commit(),false);assert.equal(calls.length,2);rate.setDraft('0');assert.equal(await rate.commit(),true);assert.equal(calls[2].value,'0');
});
test('an older ACK cannot overwrite a newer stepped draft',async()=>{
 let resolve!:(result:ProductPercentagePatchResult)=>void;let input!:ProductPercentagePatch;
 const group=createSinglePercentageControllers({productId:'p',kind:'ENGINEERING',initial:{ratePercent:'5',assigneeId:'e'},revision:0,save:request=>{input=request;return new Promise(done=>{resolve=done;});}});
 const rate=group.controllers.ratePercent;rate.setDraft('5.1');const pending=rate.commit();await new Promise(done=>setTimeout(done,0));rate.setDraft(stepPercentageDraft(rate.getSnapshot().draft,1)!);resolve(saved(input));await pending;assert.equal(rate.getSnapshot().draft,'5.6');assert.equal(rate.getSnapshot().baseline,'5.1');assert.equal(rate.getSnapshot().status,'dirty');
});

// Источник: single-product-percentage-coverage.test.ts
const actor={id:'manager',name:'Manager',roles:['MANAGER' as const],source:'web' as const};
function coveredFixture(state:string|null,rate='5',kind:'ASSEMBLY'|'INSTALLATION'='INSTALLATION'){
 const f=taskShareFixture();
 f.database.productPercentageConfig.findMany=(async()=>[{kind,ratePercent:new Prisma.Decimal(rate),workReview:[{workId:'work',classification:'COVERED'}],product:{projectId:'project',quantity:1,expectedPrice:new Prisma.Decimal('1000'),project:{currency:'BYN'},mounter:{active:true,roles:['MOUNTER']},assembler:{active:true,roles:['WORKER']},percentageCompletions:state?[{kind,state,calculationVersion:2,ratePercentSnapshot:new Prisma.Decimal(rate)}]:[]}}]) as never;
 Object.assign(f.database.work,{findMany:async()=>f.state().works.map(work=>({...work,tasks:f.state().tasks.filter(task=>task.workId===work.id)}))});
 Object.assign(f.database.payrollEntry,{findMany:async()=>f.state().entries});
 return f;
}
test('retired direct coverage leaves ordinary PIECE accrual independent',async()=>{
 for(const kind of ['ASSEMBLY','INSTALLATION'] as const)for(const state of [null,'SETTLED']){const f=coveredFixture(state,'5',kind);assert.equal((await changeTaskStatusCore(actor,'source','DONE',20,f.transaction)).ok,true);assert.equal(f.state().entries.length,1);assert.equal(f.state().tasks[0].status,'DONE');}
});
test('SKIPPED/protected/zero configurations preserve legacyPIECE, including historicalgroups',async()=>{
 for(const [state,rate] of [['SKIPPED_ONCE','5'],['LEGACY_PROTECTED','5'],[null,'0']] as const){const f=coveredFixture(state,rate);assert.equal((await changeTaskStatusCore(actor,'source','DONE',20,f.transaction)).ok,true);assert.equal(Number(f.state().entries[0].amount),1000);}
 const f=coveredFixture('SETTLED');Object.assign(f.state().tasks[0],{allocationGroupId:'historic',shareUnits:700000,shareAmount:'700.00'});f.state().groups.push({id:'historic',workId:'work',quantity:'10',budget:'1000.00',currency:'BYN',budgetSource:'TASK_FIXED'});assert.equal((await changeTaskStatusCore(actor,'source','DONE',20,f.transaction)).ok,true);assert.equal(Number(f.state().entries[0].amount),700);
});
