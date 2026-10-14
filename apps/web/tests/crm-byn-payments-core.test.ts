import assert from 'node:assert/strict';
import {test} from 'node:test';
import {requireHistoricalByn} from '../src/lib/history-byn';
test('server cap snapshot sums retain decimal cents beyond binary safe precision',()=>{
 assert.equal(requireHistoricalByn([{amount:'0',bynAmount:'90071992547409.91'},{amount:'0',bynAmount:'0.02'}]).toFixed(2),'90071992547409.93');
});
