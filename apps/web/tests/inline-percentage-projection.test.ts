import test from "node:test";
import assert from "node:assert/strict";
import { projectedPercentagePrice, projectedPercentageTotal, canRebaseSuggestedParticipants } from "../src/lib/inline-percentage-projection";
test("DRAFT uses newly acknowledged unit price, including zero/null; frozen snapshots unchanged",()=>{
 assert.equal(projectedPercentagePrice("DRAFT","10.01","20.02"),"20.02");assert.equal(projectedPercentagePrice("DRAFT","10.01",null),null);assert.equal(projectedPercentagePrice("DRAFT",null,"0.00"),"0.00");
 for(const state of ["SETTLED","PENDING_FX","LEGACY_PROTECTED","SKIPPED_ONCE"] as const)assert.equal(projectedPercentagePrice(state,"10.01","20.02"),"10.01");
});
test("only pristine suggested receiver follows acknowledged engineer; explicit recipients and drafts stay",()=>{
 const previous=[{userId:"old-engineer",shareUnits:1000000}],next=[{userId:"new-engineer",shareUnits:1000000}];
 const input={state:"DRAFT" as const,hasConfiguration:false,previous,next,participants:previous,shares:{"old-engineer":"100"},otherDirty:false};
 assert.equal(canRebaseSuggestedParticipants(input),true);assert.equal(canRebaseSuggestedParticipants({...input,hasConfiguration:true}),false);assert.equal(canRebaseSuggestedParticipants({...input,otherDirty:true}),false);assert.equal(canRebaseSuggestedParticipants({...input,shares:{"old-engineer":"50"}}),false);assert.equal(canRebaseSuggestedParticipants({...input,state:"SETTLED"}),false);
});

test("DRAFT total follows acknowledged unit price and existing rate; no quantity multiplier or frozen rewrite",()=>{
 assert.equal(projectedPercentageTotal("DRAFT","0.50","20.02","5"),"1.00");assert.equal(projectedPercentageTotal("DRAFT","0.50","0.00","5"),"0.00");assert.equal(projectedPercentageTotal("DRAFT","0.50",null,"5"),null);
 for(const state of ["SETTLED","PENDING_FX","LEGACY_PROTECTED","SKIPPED_ONCE"] as const)assert.equal(projectedPercentageTotal(state,"0.50","20.02","5"),"0.50");
});
