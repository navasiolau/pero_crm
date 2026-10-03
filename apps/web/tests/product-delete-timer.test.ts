import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire,Module} from 'node:module';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const filename=require.resolve(name),stub=new Module(filename);stub.filename=filename;stub.loaded=true;stub.exports=exports;require.cache[filename]=stub;}
let exists=true,inTransaction=false,writes=0,revalidations=0;
const tx={task:{findMany:async()=>{assert.equal(inTransaction,true);return[];},findFirst:async()=>{assert.equal(inTransaction,true);return exists?{id:'t',assigneeId:'m',status:'NEW'}:null}},timeEntry:{updateMany:async()=>{assert.equal(inTransaction,true);writes++;},create:async()=>{assert.equal(inTransaction,true);writes++;}},$executeRaw:async()=>{assert.equal(inTransaction,true);writes++;}};
inject('../src/auth',{auth:async()=>({user:{id:'m',roles:['MANAGER']}})});
inject('../src/lib/prisma',{prisma:new Proxy({}, {get(){throw Error('GLOBAL_DB_BEFORE_SERIALIZATION_FORBIDDEN')}})});
inject('../src/server/tasks/transaction',{withTaskTransaction:async(fn:(tx:unknown)=>Promise<unknown>)=>{inTransaction=true;try{return await fn(tx)}finally{inTransaction=false}}});
inject('../src/server/plugins/changelog',{writeChangeLog:async()=>{}});
inject('next/cache',{revalidatePath:()=>{revalidations++;}});
const {startTimer}=require('../src/server/time/actions') as typeof import('../src/server/time/actions');
test('timer start reads current task after global transaction boundary, missing/deleted execution context refuses all timer writes',async()=>{exists=false;writes=revalidations=0;assert.equal((await startTimer('t')).ok,false);assert.equal(writes,0);assert.equal(revalidations,0);});
test('permitted timer start keeps previous stop/minutes/newtimer semantics entirely inside transaction',async()=>{exists=true;writes=revalidations=0;assert.equal((await startTimer('t')).ok,true);assert.equal(writes,3);assert.equal(revalidations,1);});
