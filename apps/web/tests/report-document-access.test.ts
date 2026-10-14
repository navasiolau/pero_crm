import assert from 'node:assert/strict';import test from 'node:test';
import {loadMovementReportDocuments} from '../src/server/warehouse/report-documents';
const file={id:'document',source:'finance' as const,fileName:'Накладная.pdf',mimeType:'application/pdf'};
test('warehouse document lookup is one batch and financial roles are a union',async()=>{
 let reads=0;const db={stockPurchase:{findMany:async(input:unknown)=>{reads++;assert.deepEqual((input as {where:{movementId:{in:string[]}}}).where.movementId.in,['m1','m2']);return [{movementId:'m1',payment:{reportDocument:{...file,state:'READY'}}},{movementId:'m2',payment:{reportDocument:{...file,id:'pending',state:'PENDING'}}}];}}} as unknown as Parameters<typeof loadMovementReportDocuments>[2];
 assert.equal((await loadMovementReportDocuments({roles:['MANAGER']},['m1','m2'],db)).size,0);assert.equal(reads,0);
 const result=await loadMovementReportDocuments({roles:['MANAGER','PROCUREMENT']},['m1','m2','m1'],db);
 assert.equal(reads,1);assert.deepEqual(result.get('m1'),file);assert.equal(result.has('m2'),false);
 assert.equal((await loadMovementReportDocuments({roles:['ACCOUNTANT']},[],db)).size,0);assert.equal(reads,1);
});
