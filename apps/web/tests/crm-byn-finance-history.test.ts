import assert from "node:assert/strict";
import { test } from "node:test";
import { historicalByn, sumHistoricalByn, subtractByn, requireHistoricalByn } from "../src/lib/history-byn";

// Источник: crm-byn-finance-history.test.ts
test('fixed snapshot wins over foreign source and confirmed zero is preserved', () => {
 assert.equal(historicalByn({ amount: '100', currency: 'USD', bynAmount: '300' })?.toFixed(2), '300.00');
 assert.equal(historicalByn({ amount: '100', currency: 'USD', bynAmount: '0' })?.toFixed(2), '0.00');
});
test('history without evidence never uses current setting or treats unknown as zero', () => {
 assert.equal(historicalByn({ amount: '100', currency: 'USD' }), null);
 assert.equal(historicalByn({ amount: '100' }), null);
 assert.equal(sumHistoricalByn([{amount:'5',currency:'BYN'},{amount:'100',currency:'USD'}]),null);
 assert.equal(subtractByn(5,null),null);
});
test('BYN history and decimal round half up', () => {
 assert.equal(sumHistoricalByn([{amount:'0.1',currency:'BYN'},{amount:'0.2',currency:'BYN'}]),0.3);
 assert.equal(sumHistoricalByn([{amount:'1.005',currency:'BYN'}]),1.01);
 assert.equal(sumHistoricalByn([]),0);
});

// Источник: crm-byn-payments-core.test.ts
test('server cap snapshot sums retain decimal cents beyond binary safe precision',()=>{
 assert.equal(requireHistoricalByn([{amount:'0',bynAmount:'90071992547409.91'},{amount:'0',bynAmount:'0.02'}]).toFixed(2),'90071992547409.93');
});
