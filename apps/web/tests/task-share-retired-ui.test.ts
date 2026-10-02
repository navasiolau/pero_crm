import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {allocatedWorkQuantity,taskPieceAmount} from "../src/lib/work-shares";
import {TaskSplitDialog} from "../src/components/task-split-dialog";
import {remainingWorkQuantity} from "../src/lib/work-quantity";

test("task and personal views expose no stale split launcher regardless of canSplit projection",()=>{
 for(const path of ["src/components/task-dialog.tsx","src/app/(app)/my/my-tasks-view.tsx"]){
  const source=readFileSync(path,"utf8");
  assert.equal(/TaskSplitDialog|setSplitOpen|setSplitFor|Разделить/.test(source),false);
  assert.match(source,/sharePercent\(task.shareUnits\)/,"historical readonly share stays available");
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
