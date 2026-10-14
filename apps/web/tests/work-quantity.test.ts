import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { remainingWorkQuantity, stepWorkQuantity } from "../src/lib/work-quantity";
import { quantityAtoms, allocatedWorkQuantity, taskPieceAmount } from "../src/lib/work-shares";
import { randomUUID } from "node:crypto";
import { type DomainActor } from "../src/server/projects/core";
import { splitTaskCore, type SplitTaskInput } from "../src/server/tasks/share-core";
import { taskShareFixture, historicalTaskAllocation } from "./helpers/task-share-fixture";
import { canSplitTask } from "../src/server/tasks/share-policy";
import { taskPaymentLabel } from "../src/lib/task-payment-display";
import { TaskSplitDialog } from "../src/components/task-split-dialog";
import { requiresManualCompletionTime } from "../src/lib/task-completion-prompt";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { elapsedTextFor, formatElapsed, useElapsed } from "../src/lib/use-elapsed";

// Источник: work-quantity.test.ts
test("fractional remaining 10.30 minus 10.00 is an exact 0.30 for the All button", () => {
  const remaining = remainingWorkQuantity("10.30", "10.00");
  assert.equal(remaining, "0.30");
  assert.equal(quantityAtoms(Number(remaining)), BigInt(30));
});

test("editing adds back the task's own decimal quantity without floating residue", () => {
  assert.equal(remainingWorkQuantity("10.30", "10.00", "0.20"), "0.50");
  assert.equal(remainingWorkQuantity("0.30", "0.10", "0.10"), "0.30");
});

test("plus and minus preserve fractional precision and clamp to fractional bounds", () => {
  assert.equal(stepWorkQuantity("2.30", "10.30", -1), "1.30");
  assert.equal(stepWorkQuantity("0.14", "10.30", 1), "1.14");
  assert.equal(stepWorkQuantity("", "0.30", 1), "0.30");
  assert.equal(stepWorkQuantity("1.30", "10.30", -1), "0.30");
});

test("genuine third decimal digits are rejected rather than rounded", () => {
  for (const value of ["0.301", "1.234", "1.0001"]) {
    assert.throws(() => quantityAtoms(value));
    assert.throws(() => stepWorkQuantity(value, "10.30", 1));
  }
});

test("all additive DDL is enclosed in one explicit transaction", () => {
  const sql = readFileSync(new URL("../prisma/migrations/20260928140000_universal_work_shares/migration.sql", import.meta.url), "utf8").replace(/^--.*$/gm, "").trim();
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;$/);
  assert.equal((sql.match(/\bBEGIN;/g) ?? []).length, 1);
  assert.equal((sql.match(/\bCOMMIT;/g) ?? []).length, 1);
  assert.doesNotMatch(sql, /\bCONCURRENTLY\b/);
});

// Источник: work-shares-core.test.ts
const actor:DomainActor={id:'worker',name:'Worker',roles:['WORKER'],source:'web'};
const input=(changes:Partial<SplitTaskInput>={}):SplitTaskInput=>({taskId:'source',recipientId:'recipient',percent:'30',expectedRevision:0,requestId:randomUUID(),...changes});
test('retirement rejects inactive recipients, stale revision, completed/paid and standalone tasks without modifying state',async()=>{
 for(const variation of ['inactive','stale','done','paid','standalone','oldgroup']) {
 const f=taskShareFixture(); const request=input();
 if(variation==='inactive')f.state().users.find(user=>user.id==='recipient')!.active=false;
 if(variation==='stale')request.expectedRevision=5;
 if(variation==='done')f.state().tasks[0].status='DONE';
 if(variation==='paid')f.state().entries.push({id:'paid',taskId:'source',amount:'1000.00'});
 if(variation==='standalone')f.state().tasks[0].workId=null;
 if(variation==='oldgroup')historicalTaskAllocation(f);
 const before=structuredClone(f.state());
 assert.equal((await splitTaskCore(actor,request,f.transaction)).ok,false,variation);
 assert.deepEqual(f.state(),before);assert.deepEqual(f.writes,[]);
 }
});
test('prior committed receipt replays only the same actor and exact payload without writes',async()=>{
 const f=taskShareFixture();historicalTaskAllocation(f);const request=input();
 f.state().logs.push({id:`task-split:${request.requestId}`,actorId:'worker',entityId:'source',action:'split',newValue:{recipientId:'recipient',percent:'30.00',expectedRevision:0,childTaskId:'historic-child',groupId:'historic-group'}});
 const before=structuredClone(f.state());
 const replay=await splitTaskCore(actor,request,f.transaction);assert.ok(replay.ok);assert.equal(replay.repeated,true);
 for(const change of [{percent:'50'},{recipientId:'accountant'},{expectedRevision:1}])assert.equal((await splitTaskCore(actor,{...request,...change},f.transaction)).ok,false);
 assert.equal((await splitTaskCore({...actor,id:'manager',roles:['MANAGER']},request,f.transaction)).ok,false);
 assert.deepEqual(f.state(),before);assert.deepEqual(f.writes,[]);
});
test('concurrent new requests create no allocation, children, dependencies, audit or outbox',async()=>{
 const f=taskShareFixture();const before=structuredClone(f.state());
 const results=await Promise.all([splitTaskCore(actor,input(),f.transaction),splitTaskCore(actor,input(),f.transaction)]);
 assert.ok(results.every(result=>!result.ok));assert.deepEqual(f.state(),before);assert.deepEqual(f.writes,[]);
});

// Источник: task-share-retirement.test.ts
for (const roles of [['ADMIN'],['DIRECTOR'],['MANAGER'],['WORKER'],['MOUNTER'],['ACCOUNTANT'],['ENGINEER'],['MANAGER','ENGINEER']] as DomainActor['roles'][]) {
 test(`new split denied without writes ${roles}`,async()=>{
 const f=taskShareFixture(); const actor:DomainActor={id:roles.includes('WORKER')?'worker':'manager',name:'actor',roles,source:'web'};
 const result=await splitTaskCore(actor,{taskId:'source',recipientId:'recipient',percent:'30',expectedRevision:0,requestId:randomUUID()},f.transaction);
 assert.equal(result.ok,false); assert.deepEqual(f.writes,[]);
 assert.equal(canSplitTask(actor,{assigneeId:actor.id,status:'NEW',product:null,paidCount:0}),false);
 });
}
test('historical grouped budget counts quantity once and preserves fixed40+60',()=>{
 const rows=[{quantity:'10',allocationGroupId:'old',shareAmount:'40',executorShare:'0.4'},{quantity:'10',allocationGroupId:'old',shareAmount:'60',executorShare:'0.6'}];
 assert.equal(allocatedWorkQuantity(rows),'10.00');
 assert.deepEqual(rows.map(row=>taskPieceAmount(row,'10')),['40.00','60.00']);
 assert.equal(taskPieceAmount({quantity:'4',executorShare:'0.5',shareAmount:null},'10'),'20.00');
});

// Источник: task-share-retired-ui.test.ts
test("task and personal views expose no stale split launcher regardless of canSplit projection",()=>{
 for(const path of ["src/components/task-dialog.tsx","src/app/(app)/my/my-tasks-view.tsx"]){
  const source=readFileSync(path,"utf8");
  assert.equal(/TaskSplitDialog|setSplitOpen|setSplitFor|Разделить/.test(source),false);
  assert.doesNotMatch(source,/sharePercent\(task.shareUnits\)|Сумма доли|Доля прежнего фонда|Ваша доля|Доля объёма/);
  assert.match(source,/taskPaymentLabel\(task\)/);assert.match(source,/Вознаграждение/);
 }
});
test("percentage settings cannot launch transfer or change participant allocation",()=>{
 const source=readFileSync("src/app/(app)/products/[id]/product-percentage-panel.tsx","utf8");
 assert.equal(/transferProductPercentageShareAction|transferShare|addParticipant|removeParticipant|Добавить участника|Передать долю/.test(source),false);
 assert.equal(/participants:\s*configuredShares/.test(source),false);
 assert.doesNotMatch(source,/Сохранённый результат этапа|Прежнее начисление, только история/);
 assert.doesNotMatch(source,/shareUnitsToPercentageText\(row.shareUnits\)/);
});

test("stale split dialog is inert for every role/combined role even when old projection says canSplit",()=>{
 let commands=0;
 for(const roles of [["ADMIN"],["DIRECTOR"],["MANAGER"],["ENGINEER"],["ACCOUNTANT"],["WORKER"],["MOUNTER"],["MANAGER","ENGINEER"]]){
  const props={task:{id:"legacy-task",title:"Old unfinished",roles,canSplit:true},open:true,onOpenChange:()=>{commands++},onDone:()=>{commands++}};
  assert.equal(TaskSplitDialog(props),null);
 }
 assert.equal(commands,0);
});

test("historical 40+60 snapshots remain exact and group quantity counts once",()=>{
 const left={quantity:"10.00",executorShare:"0.400",allocationGroupId:"legacy-group",shareUnits:400000,shareAmount:"40.00"};
 const right={...left,executorShare:"0.600",shareUnits:600000,shareAmount:"60.00"};
 assert.equal(allocatedWorkQuantity([left,right]),"10.00");
 assert.equal(taskPieceAmount(left,"999.00"),"40.00");assert.equal(taskPieceAmount(right,"999.00"),"60.00");
 assert.equal(taskPieceAmount({quantity:"10.00",executorShare:"0.400"},"10.00"),"40.00");
});

test("ordinary quantity distribution 4+6 of10 keeps full per-task pay and no remaining excess",()=>{
 const tasks=[{quantity:"4.00",executorShare:"1.000"},{quantity:"6.00",executorShare:"1.000"}];
 assert.equal(allocatedWorkQuantity(tasks),"10.00");assert.equal(remainingWorkQuantity("10.00",allocatedWorkQuantity(tasks)),"0.00");
 assert.deepEqual(tasks.map(task=>taskPieceAmount(task,"10.00")),["40.00","60.00"]);
});

test("task rewards use canonical zero and frozen DTO amounts without old-share or engineering-preview fallback",()=>{
 assert.match(taskPaymentLabel({workId:"work",rewardAmount:"0.00",rewardCurrency:"BYN",rewardSource:"WORK_SNAPSHOT",shareAmount:"999",shareCurrency:"USD"}),/0.*BYN/);
 assert.match(taskPaymentLabel({workId:"work",rewardAmount:"17.89",rewardCurrency:"BYN",rewardSource:"FROZEN_TASK_SNAPSHOT",previewAmount:"999",previewCurrency:"USD"}),/17,89.*BYN/);
 assert.equal(taskPaymentLabel({workId:"work",rewardAmount:null,rewardCurrency:null,rewardSource:"UNAVAILABLE",paymentKind:"ENGINEERING",previewAmount:"999",previewCurrency:"BYN",shareAmount:"888",shareCurrency:"BYN"}),"—");
});

// Источник: task-completion-prompt.test.ts
test("an engineer's active timer completes without requesting fabricated manual time", () => {
  assert.equal(requiresManualCompletionTime({ id: "own", spentMinutes: 0 }, true, "own"), false);
});
test("missing time still prompts office roles, including when a different task has the timer", () => {
  assert.equal(requiresManualCompletionTime({ id: "own", spentMinutes: 0 }, true, null), true);
  assert.equal(requiresManualCompletionTime({ id: "own", spentMinutes: 0 }, true, "different"), true);
  assert.equal(requiresManualCompletionTime({ id: "own", spentMinutes: 5 }, true, null), false);
});
test("field roles never receive the manual-time dialog", () => {
  assert.equal(requiresManualCompletionTime({ id: "own", spentMinutes: 0 }, false, null), false);
});

// Источник: use-elapsed.test.ts
function Timer({ startedAt }: { startedAt: string | null }) {
  return createElement("span", null, useElapsed(startedAt));
}

test("active timer server markup is stable across different render times", () => {
  const originalNow = Date.now;
  try {
    Date.now = () => Date.parse("2026-09-29T12:00:00.000Z");
    const first = renderToString(createElement(Timer, { startedAt: "2026-09-29T11:59:00.000Z" }));
    Date.now = () => Date.parse("2026-09-29T12:00:01.000Z");
    const second = renderToString(createElement(Timer, { startedAt: "2026-09-29T11:59:00.000Z" }));

    assert.equal(second, first);
    assert.equal(first, "<span>—</span>");
  } finally {
    Date.now = originalNow;
  }
});

test("elapsed formatting keeps minute and hour boundaries", () => {
  const startedAt = "2026-09-29T11:00:00.000Z";
  const start = Date.parse(startedAt);
  assert.equal(formatElapsed(startedAt, start + 59_000), "00:59");
  assert.equal(formatElapsed(startedAt, start + 60_000), "01:00");
  assert.equal(formatElapsed(startedAt, start + 3_661_000), "1:01:01");
  assert.equal(formatElapsed(startedAt, start - 1), "00:00");
});

test("changing active timer never displays the previous timer snapshot", () => {
  const oldStartedAt = "2026-09-29T10:00:00.000Z";
  const newStartedAt = "2026-09-29T11:00:00.000Z";
  assert.equal(elapsedTextFor(newStartedAt, {
    startedAt: oldStartedAt,
    now: Date.parse("2026-09-29T12:00:00.000Z"),
  }), "—");
  assert.equal(elapsedTextFor(null, { startedAt: oldStartedAt, now: Date.now() }), "");
});
