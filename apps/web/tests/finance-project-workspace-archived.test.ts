import assert from 'node:assert/strict';
import test from 'node:test';
import type {PrismaClient,Role} from '@prisma/client';
import {liveProjectWhere} from '../src/server/access/live-entities';
import {selectableFinanceProjectsWhere,listFinanceProjectRefs,getFinanceProjectRef} from '../src/server/finance/project-refs';
test('picker excludes deleted projects while historical lookup retains an explicit archived flag',async()=>{
 assert.deepEqual(selectableFinanceProjectsWhere(),liveProjectWhere);
 const inputs: Array<{where:unknown}>=[];const row={id:'j',number:'1',title:'Old',currency:'BYN',stage:'LEAD',deletedAt:new Date() as Date|null,client:{name:'C',lastName:null,middleName:null}};
 const db={project:{findMany:async(i:{where:unknown})=>{inputs.push(i);return[row];},findFirst:async(i:{where:unknown})=>{inputs.push(i);return row;}}} as unknown as Pick<PrismaClient,'project'>;
 const actor={id:'a',roles:['ACCOUNTANT' as Role]};const picker=await listFinanceProjectRefs(actor,'',db);assert.deepEqual(Object.keys(picker[0]).sort(),['id','number','title','currency'].sort());assert.deepEqual(inputs[0].where,{AND:[liveProjectWhere,{}]});
 const historic=await getFinanceProjectRef(actor,'j',db);assert.equal(historic?.projectArchived,true);assert.deepEqual(inputs[1].where,{id:'j'});assert.ok(!JSON.stringify(historic).includes('deletedAt'));
 row.deletedAt=null;assert.equal((await getFinanceProjectRef(actor,'j',db))?.projectArchived,false);
});
