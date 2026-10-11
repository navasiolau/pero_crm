import assert from 'node:assert/strict';

// V8 хранит вложенные overrides, а следующий snapshot может дробить те же blocks иначе.
export function mergeV8FunctionCoverage(snapshots) {
  assert.ok(snapshots.length,'V8_FUNCTION_SNAPSHOTS_REQUIRED');
  const outer=snapshots[0].ranges[0], boundaries=new Set([outer.startOffset,outer.endOffset]);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.ranges[0].startOffset,outer.startOffset,'V8_VARIANT_FUNCTION_START_MISMATCH');
    assert.equal(snapshot.ranges[0].endOffset,outer.endOffset,'V8_VARIANT_FUNCTION_END_MISMATCH');
    for (const range of snapshot.ranges) {
      assert.ok(Number.isInteger(range.startOffset)&&Number.isInteger(range.endOffset)&&range.startOffset>=outer.startOffset&&range.endOffset<=outer.endOffset&&range.startOffset<range.endOffset&&range.count>=0,'V8_RANGE_INVALID');
      boundaries.add(range.startOffset);boundaries.add(range.endOffset);
    }
  }
  const points=[...boundaries].sort((a,b)=>a-b), effectiveRanges=[];
  for (let index=0;index<points.length-1;index++) {
    const startOffset=points[index],endOffset=points[index+1];
    const executed=snapshots.some(snapshot=>{
      let innermost=null;
      for (const range of snapshot.ranges) if (range.startOffset<=startOffset&&endOffset<=range.endOffset) {
        if (!innermost||range.endOffset-range.startOffset<=innermost.endOffset-innermost.startOffset) innermost=range;
      }
      return innermost.count>0;
    });
    const previous=effectiveRanges.at(-1),count=executed?1:0;
    if (previous&&previous.count===count&&previous.endOffset===startOffset) previous.endOffset=endOffset;
    else effectiveRanges.push({startOffset,endOffset,count});
  }
  return {...snapshots[0],ranges:[{...outer,count:snapshots.some(snapshot=>snapshot.ranges[0].count>0)?1:0}],effectiveRanges};
}
