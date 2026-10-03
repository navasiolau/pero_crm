import assert from "node:assert/strict";
import test from "node:test";
import type { Role } from "@prisma/client";
import { assignedProductVisibilityWhere, productVisibilityWhere, projectVisibilityWhere, productEditWhere, taskExecutionWhere, canEditProductTechnicalBlock } from "../src/server/access/visibility";
import { matches, type FixtureRow } from "./helpers/visibility-fixture";

const worker = {id:"assembler", roles:["WORKER" as Role]};
const product = {id:"p", assemblerId:"assembler", engineerId:null, status:"PRODUCTION", assembler:{id:"assembler",active:true,roles:["WORKER"]},tasks:[],project:{tasks:[]}};
const assignedVisible = (actor:typeof worker,row:FixtureRow) => matches(row,assignedProductVisibilityWhere(actor) as FixtureRow);
const visible = (actor:typeof worker, row:FixtureRow) => matches(row, productVisibilityWhere(actor) as FixtureRow);
test("assigned active assembler reads nonDESIGN product and parent without a task", () => {
  assert.equal(visible(worker, product), true);
  assert.equal(matches({products:[product],tasks:[]},projectVisibilityWhere(worker) as FixtureRow), true);
});
test("assembler assignment is scoped to active eligible worker and nonDESIGN", () => {
  assert.equal(assignedVisible(worker,{...product,status:"DESIGN"}),false);
  assert.equal(assignedVisible(worker,{...product,assemblerId:"foreign"}),false);
  assert.equal(assignedVisible(worker,{...product,assembler:{...product.assembler,active:false}}),false);
  assert.equal(assignedVisible(worker,{...product,assembler:{...product.assembler,roles:["MOUNTER"]}}),false);
  assert.equal(assignedVisible({id:"assembler",roles:["MOUNTER"]},product),false);
  assert.equal(assignedVisible({id:"assembler",roles:["WORKER","ENGINEER"]},product),true);
});
test("assigned read never grants technical edits or somebody else's task execution", () => {
  assert.equal(matches(product,productEditWhere(worker) as FixtureRow),false);
  assert.equal(canEditProductTechnicalBlock(worker,product as Parameters<typeof canEditProductTechnicalBlock>[1]),false);
  assert.equal(matches({id:"task",assigneeId:"other",product},taskExecutionWhere(worker) as FixtureRow),false);
});
