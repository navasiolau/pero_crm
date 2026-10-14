import assert from "node:assert/strict";
import {test} from "node:test";
import {timerStopSnapshot} from "../src/server/time/timers";

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
