import assert from 'node:assert/strict';
import {test} from 'node:test';
import {legacyAutomationHints} from '../src/server/changelog/legacy-automation';
import type {JournalEntryInput} from '../src/server/changelog/contract';
const entry=(patch:Partial<JournalEntryInput>):JournalEntryInput=>({actorType:'user',actorId:'initiator',actorName:'Инициатор',entity:'product',entityId:'p1',action:'update',...patch});
test('only proven historical automatic writer schemas show System with the real initiator',()=>{
 for(const input of [
  entry({action:'kp.synchronize',newValue:{proposalId:'cp'}}),
  entry({entity:'project',action:'proposal.pricing.sync',oldValue:{project:{},products:[]},newValue:{proposalId:'cp',project:{},items:[]}}),
  entry({action:'kp.cover',newValue:{proposalId:'cp',previousFileId:null,sketchFileId:'new'}}),
  entry({entity:'file',action:'kp.retire',newValue:{proposalId:'cp',sourceItemId:'i',sourceMediaId:'m',retiredAt:'2026-11-16'}}),
  entry({action:'number.change',field:'number',oldValue:{number:'203.2',suffixInt:2},newValue:{number:'203.1',suffixInt:1}}),
  entry({entity:'commercialProposal',action:'client.synchronize',oldValue:{clientId:'old',revision:1},newValue:{clientId:'new',revision:2,projectId:'pr'}}),
  entry({action:'initialPrice.capture',oldValue:{initialPrice:null,initialPriceCaptureEligible:true},newValue:{initialPrice:'200',initialPriceCaptureEligible:false}}),
 ]){
  const before=JSON.stringify(input),result=legacyAutomationHints(input);
  assert.equal(result?.actor?.type,'system');assert.equal(result?.initiator?.id,'initiator');assert.ok(result?.reason);assert.equal(JSON.stringify(input),before);
 }
});
test('ambiguous ordinary statuses and malformed automation records keep the saved user',()=>{
 for(const input of [entry({action:'status',field:'status',oldValue:'DRAFT',newValue:'PREPARATION'}),entry({entity:'project',action:'stage',newValue:'CONTRACT'}),entry({action:'kp.synchronize',newValue:{title:'no provenance'}}),entry({action:'number.change',oldValue:{number:'1.2'},newValue:{number:'1.1'}}),entry({entity:'task',action:'kp.synchronize',newValue:{proposalId:'cp'}})])assert.equal(legacyAutomationHints(input),null);
});
