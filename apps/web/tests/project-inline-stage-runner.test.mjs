import assert from 'node:assert/strict';
import {test} from 'node:test';
import {projectJournalScope,closedProjectApiProbe} from './project-inline-stage-runner.mjs';
const fixture={ids:{project:'owned-project'},actors:{admin:{id:'admin'},manager:{id:'manager'}}};
const mutationId='b5428289-23f7-4e42-a967-212da990d141';
const field={actorId:'manager',projectId:'owned-project',field:'title',clientMutationId:mutationId};
const journal=ownWrites=>({ownWrites,preferenceOwnWrites:[]});
test('coordinator scope collects successful field/status IDs and excludes no-op receipts',()=>{
 const stageId='d5428289-23f7-4e42-a967-212da990d141';
 assert.deepEqual(projectJournalScope(fixture,journal([field,{...field,noOp:true},{actorId:'admin',projectId:fixture.ids.project,type:'status',saved:true,toStage:'REFUSED',clientMutationId:stageId},{actorId:'admin',type:'file-delete',saved:true,fileId:'owned-file'}])),{mutationIds:[mutationId],stageMutationIds:[stageId],legacyApiWrites:[]});
 assert.deepEqual(projectJournalScope(fixture,journal([{...field,noOp:true},{actorId:'admin',projectId:fixture.ids.project,type:'status',saved:true,toStage:'REFUSED',clientMutationId:stageId,noOp:true}])),{mutationIds:[],stageMutationIds:[],legacyApiWrites:[]});
});
test('coordinator rejects unrecognized actor, project, field, UUID and unconfirmed delete',()=>{
 for(const row of [{...field,actorId:'foreign'},{...field,projectId:'foreign'},{...field,field:'initialPrice'},{...field,clientMutationId:'guess'},{actorId:'admin',type:'file-delete',saved:false,fileId:'owned-file'}])assert.throws(()=>projectJournalScope(fixture,journal([row])),/STOP/);
});
test('Node API accepts only the closed owned title envelope, not caller URL/header/source',()=>{
 const input={projectId:fixture.ids.project,field:'title',value:'QA18 compiled API title',expectedValue:'QA18 title',clientMutationId:mutationId};assert.deepEqual(closedProjectApiProbe(input,fixture),input);
 for(const invalid of [null,[],{...input,projectId:'foreign'},{...input,field:'initialPrice'},{...input,url:'https://production'},{...input,headers:{authorization:'fake'}},{...input,expectedValue:null},{...input,clientMutationId:undefined}])assert.throws(()=>closedProjectApiProbe(invalid,fixture),/REQUIRED/);
});
