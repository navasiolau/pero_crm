import assert from "node:assert/strict";
import {test} from "node:test";
import {timerStopSnapshot} from "../src/server/time/timers";
import {randomUUID} from "node:crypto";
import type {Prisma} from "@prisma/client";
import {applyTaskTimeCutoff,planTaskTimeCutoff,type TaskTimeCutoffPorts,type TaskTimeCutoffRequest} from "../src/server/time/cutoff";

const instant = new Date("2026-10-11T12:00:00Z");
test("one pure snapshot covers second/minute/12h boundaries without mutating input dates",()=>{
  for(const [elapsed,minutes,autoStopped] of [[0,1,false],[59000,1,false],[719*60000+59000,719,false],
    [720*60000-1,719,false],[720*60000,720,true],[721*60000,720,true],[1200*60000,720,true]] as const){
    const start=new Date(instant.getTime()-elapsed),before=start.getTime(),stopped=timerStopSnapshot(start,instant);
    assert.equal(stopped.minutes,minutes);assert.equal(stopped.autoStopped,autoStopped);
    assert.equal(stopped.stoppedAt.getTime(),autoStopped?before+720*60000:instant.getTime());assert.equal(start.getTime(),before);
  }
  assert.throws(()=>timerStopSnapshot(new Date(NaN),instant),/Некорректная дата/);
});

test("reviewed cutoff closes only open timers once at one server instant and refuses guard/hash mismatch",async()=>{
  const request:TaskTimeCutoffRequest={operationId:randomUUID(),actorId:"operator",retiredRevision:"a".repeat(40),target:{kind:"local5433",revision:"b".repeat(40),imageDigest:null,database:{name:"pero_crm",schema:"public",systemIdentifier:"123456"}}};
  const rows=[
    {id:"expired",taskId:"task",userId:"user",source:"timer",startedAt:new Date(instant.getTime()-1200*60000),stoppedAt:null as Date|null,minutes:0,autoStopped:false},
    {id:"recent",taskId:"task",userId:"user",source:"timer",startedAt:new Date(instant.getTime()-10000),stoppedAt:null as Date|null,minutes:0,autoStopped:false},
    {id:"closed",taskId:"task",userId:"user",source:"timer",startedAt:new Date(0),stoppedAt:new Date(1),minutes:1200,autoStopped:false},
    {id:"manual",taskId:"task",userId:"user",source:"manual",startedAt:new Date(0),stoppedAt:null as Date|null,minutes:5,autoStopped:false},
  ];
  const protectedHistory=structuredClone(rows.slice(2)),logs:Record<string,unknown>[]=[],locks:string[]=[];let live=true,clockReads=0;
  const tx={
    $queryRaw:async(strings:TemplateStringsArray)=>{
      const sql=strings.join("");
      if(sql.includes("pg_control_system"))return[request.target.database];
      if(sql.includes("pg_advisory_xact_lock")){locks.push(sql);return[{locked:1}];}
      assert.match(sql,/clock_timestamp/);clockReads++;return[{at:instant}];
    },
    $executeRaw:async(strings:TemplateStringsArray)=>{assert.match(strings.join(""),/LOCK TABLE "TimeEntry"/);return 0;},
    user:{findUnique:async()=>({id:"operator",name:"Оператор",active:true,roles:["ADMIN"]})},
    timeEntry:{findMany:async()=>structuredClone(rows.filter(row=>row.source==="timer"&&row.stoppedAt===null)),
      updateMany:async({where,data}:{where:{id:string;source:string;stoppedAt:null};data:ReturnType<typeof timerStopSnapshot>})=>{
        assert.equal(where.source,"timer");assert.equal(where.stoppedAt,null);const row=rows.find(item=>item.id===where.id&&item.source===where.source&&item.stoppedAt===null);
        assert.ok(row);Object.assign(row,data);return{count:1};}},
    changeLog:{findUnique:async({where}:{where:{id:string}})=>logs.find(row=>row.id===where.id)??null,
      create:async({data}:{data:Record<string,unknown>})=>{logs.push(structuredClone(data));return data;}},
  };
  const ports:TaskTimeCutoffPorts={transaction:async operation=>operation(tx as unknown as Prisma.TransactionClient),
    verifyTargetAndNoOldWriters:async target=>{if(!live)throw Error("OLD_WRITER_PRESENT");return target;}};
  const plan=await planTaskTimeCutoff(ports,request);assert.equal(clockReads,0);assert.equal(logs.length,0);
  await assert.rejects(applyTaskTimeCutoff(ports,plan,"0".repeat(64)),/PLAN_MISMATCH/);
  live=false;await assert.rejects(applyTaskTimeCutoff(ports,plan,plan.fingerprint),/OLD_WRITER_PRESENT/);assert.equal(logs.length,0);
  live=true;const result=await applyTaskTimeCutoff(ports,plan,plan.fingerprint);
  assert.deepEqual(result.closedIds,["expired","recent"]);assert.equal(clockReads,1);assert.equal(result.cutoffAt,instant.toISOString());
  assert.equal(rows[0].minutes,720);assert.equal(rows[0].autoStopped,true);assert.equal(rows[1].minutes,1);assert.equal(rows[1].autoStopped,false);
  assert.deepEqual(rows.slice(2),protectedHistory);assert.equal(logs.length,3);assert.ok(locks.length>=2);
  const before=structuredClone({rows,logs});const replay=await applyTaskTimeCutoff(ports,plan,plan.fingerprint);
  assert.equal(replay.replayed,true);assert.deepEqual(replay.closedIds,result.closedIds);assert.deepEqual({rows,logs},before);assert.equal(clockReads,1);
});
