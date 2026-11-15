import assert from 'node:assert/strict';
import {test} from 'node:test';
import {escapeJournalLike,normalizeJournalQuery,normalizeJournalScope} from '../src/server/changelog/query-contract';

test('journal query defaults and Moscow half-open days do not depend on host timezone',()=>{
 const query=normalizeJournalQuery({from:'2026-11-01',to:'2026-11-02'});
 assert.deepEqual(query.scope,{kind:'global'});
 assert.equal(query.page,1);assert.equal(query.pageSize,20);assert.equal(query.sort,'time');assert.equal(query.dir,'desc');
 assert.equal(query.fromAt?.toISOString(),'2026-10-31T21:00:00.000Z');
 assert.equal(query.toBefore?.toISOString(),'2026-11-02T21:00:00.000Z');
});

test('invalid dates and forged context cannot turn into unrestricted history',()=>{
 for(const date of ['2026-02-30','2026-11-00','2026-13-01','2026-1-01'])assert.throws(()=>normalizeJournalQuery({from:date}),/дат/);
 assert.throws(()=>normalizeJournalQuery({from:'2026-11-02',to:'2026-11-01'}),/период/);
 for(const scope of [{kind:'product'},{kind:'project',id:''},{kind:'global',id:'wrong'},{kind:'client',id:'c'}])assert.throws(()=>normalizeJournalScope(scope),/контекст/);
 assert.deepEqual(normalizeJournalScope({kind:'product',id:'stable-product-id'}),{kind:'product',id:'stable-product-id'});
});

test('search is not shortened and LIKE treats user wildcard characters literally',()=>{
 const text='Длинная строка '.repeat(40)+'100%_x\\tail';
 assert.equal(normalizeJournalQuery({q:text}).q,text);
 assert.equal(escapeJournalLike('100%_x\\tail'),'100\\%\\_x\\\\tail');
 assert.throws(()=>normalizeJournalQuery({page:1.5}),/страниц/);
 assert.throws(()=>normalizeJournalQuery({pageSize:10000}),/страниц/);
 assert.throws(()=>normalizeJournalQuery({sort:'source' as 'time'}),/сортиров/);
});
