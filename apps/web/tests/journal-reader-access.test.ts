import assert from 'node:assert/strict';
import {createRequire,Module} from 'node:module';
import {test} from 'node:test';
import type {Role} from '@prisma/client';

test('real list/detail/options actions deny all non-admin roles before transaction or audit reads',async()=>{
 const require=createRequire(import.meta.url);
 const inject=(path:string,exports:Record<string,unknown>)=>{const filename=require.resolve(path),stubModule=new Module(filename);stubModule.filename=filename;stubModule.loaded=true;stubModule.exports=exports;require.cache[filename]=stubModule;};
 let roles:Role[]=['ADMIN'],transactions=0,reads=0;
 inject('../src/auth',{auth:async()=>({user:{id:'actor',roles}})});
 inject('../src/lib/prisma',{prisma:{$transaction:async()=>{transactions++;throw Error('Unexpected database access');}}});
 inject('../src/server/changelog/sql-store',{createJournalReadStore:()=>{reads++;throw Error('Unexpected journal access');}});
 const actions=require('../src/server/changelog/actions') as typeof import('../src/server/changelog/actions');
 for(const denied of [['DIRECTOR'],['PROCUREMENT'],['ACCOUNTANT'],['MANAGER'],['ENGINEER'],['WORKER'],['MOUNTER'],['WORK_COORDINATOR'],['WORK_COORDINATOR','WORKER'],['MANAGER','ENGINEER'],['ACCOUNTANT','PROCUREMENT'],[]] as Role[][]){
  roles=denied;
  await assert.rejects(()=>actions.listJournal({scope:{kind:'global'}}),/Недостаточно прав/);
  await assert.rejects(()=>actions.getJournalEntry('known-event',{kind:'product',id:'product'}),/Недостаточно прав/);
  await assert.rejects(()=>actions.listJournalFilterOptions({kind:'project',id:'project'}),/Недостаточно прав/);
 }
 assert.equal(transactions,0);assert.equal(reads,0);
 roles=['ADMIN'];
 await assert.rejects(()=>actions.listJournal({scope:{kind:'project',id:''}}),/контекст/);
 await assert.rejects(()=>actions.listJournalFilterOptions({kind:'client',id:'wrong'} as never),/контекст/);
 assert.equal(transactions,0);
});
