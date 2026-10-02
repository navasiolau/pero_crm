import assert from 'node:assert/strict';
import {test} from 'node:test';
import {projectStagePatchSchema,validateStageExtras} from '../src/server/projects/stage-contract';
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
