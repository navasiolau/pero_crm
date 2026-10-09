import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyDraftQaAction} from './product-draft-stage-browser.mjs';
const scope={actorId:'own-manager',clientId:'own-client',tags:{projectA:'QA111 primary run',products:['QA111 product run 01']},projectIds:new Set(['123','own-paused']),productIds:new Set(['own-product'])};
const project={title:scope.tags.projectA,clientId:scope.clientId,managerId:scope.actorId,address:'$undefined'};
const product={projectId:'123',title:scope.tags.products[0],kind:'$undefined',expectedPrice:0,quantity:1,description:'',engineerId:'$undefined'};
const stage={projectId:'123',toStage:'CONTRACT',expectedStage:'LEAD',clientMutationId:'80502171-fcf9-4189-a3f8-c8a77e94efad',extras:'$undefined'};
test('only exact owned project creation is accepted',()=>{
 assert.equal(classifyDraftQaAction([project],scope).kind,'project-create');
 for(const data of [{...project,clientId:'foreign'},{...project,managerId:'foreign'},{...project,title:'foreign'},{...project,address:'real unrelated address'}])assert.equal(classifyDraftQaAction([data],scope),null);
});
test('owned product creation has zero price single quantity and no assignment',()=>{
 assert.equal(classifyDraftQaAction([product],scope).kind,'product-create');
 for(const data of [{...product,projectId:'foreign'},{...product,title:'foreign'},{...product,expectedPrice:1},{...product,quantity:2},{...product,engineerId:'foreign'},{...product,description:'unexpected text'}])assert.equal(classifyDraftQaAction([data],scope),null);
});
test('non-completion owned stages require CAS UUID and closed extras',()=>{
 assert.equal(classifyDraftQaAction([stage],scope).kind,'project-stage');
 assert.equal(classifyDraftQaAction([{...stage,toStage:'IN_WORK'}],scope).kind,'project-stage');
 assert.equal(classifyDraftQaAction([{...stage,toStage:'REFUSED',extras:{refusalReason:'QA111 run'}}],scope).kind,'project-stage');
 for(const data of [{...stage,projectId:'foreign'},{...stage,toStage:'DONE'},{...stage,clientMutationId:'bad'},{...stage,extras:{unexpected:1}},{...stage,toStage:'REFUSED',extras:{refusalReason:'foreign'}}])assert.equal(classifyDraftQaAction([data],scope),null);
});
test('status changes cannot touch original products or completion states',()=>{
 assert.equal(classifyDraftQaAction(['own-product','DESIGN'],scope).kind,'product-status');
 assert.equal(classifyDraftQaAction(['own-product','PREPARATION'],scope).kind,'product-status');
 for(const args of [['foreign','PREPARATION'],['own-product','DONE'],['own-product','PRODUCTION'],['own-product','DESIGN','unexpected']])assert.equal(classifyDraftQaAction(args,scope),null);
});
test('preference writes are restricted to exact two new-user sections',()=>{
 assert.equal(classifyDraftQaAction(['projects','view=kanban',null],scope).key,'projects.list');
 assert.equal(classifyDraftQaAction(['products','view=kanban','last-ack'],scope).key,'products.list');
 for(const args of [['my','view=kanban',null],['project.tab','products',null],['products','x'.repeat(32769),null],['projects',{},null]])assert.equal(classifyDraftQaAction(args,scope),null);
});
test('arbitrary or malformed action payloads are never accepted',()=>{for(const data of [null,{},'arbitrary',[],[{}],[project,product]])assert.equal(classifyDraftQaAction(data,scope),null);});
