import assert from 'node:assert/strict';
import {createRequire,Module} from 'node:module';
import {test} from 'node:test';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const path=require.resolve(name);const stub=new Module(path);stub.filename=path;stub.loaded=true;stub.exports=exports;require.cache[path]=stub;}
let writes=0;
inject('../src/auth',{auth:async()=>({user:{id:'manager',name:'Manager',roles:['MANAGER']}})});
inject('../src/lib/prisma',{prisma:{client:{findFirst:async()=>({id:'client',name:'Old',phone:'100'}),update:async()=>{writes++;return{}}}}});
inject('next/cache',{revalidatePath:()=>{}});inject('../src/server/plugins/changelog',{writeChangeLog:async()=>{}});
inject('../src/server/access/visibility',{resolveVisibilityActor:async()=>({id:'manager',roles:['MANAGER']}),clientVisibilityWhere:()=>({})});
const {updateClient}=require('../src/server/clients/actions') as typeof import('../src/server/clients/actions');
test('standalone stale full client form without real baseline is rejected before write',async()=>{
 const result=await updateClient('client',{name:'New',phone:'200'});
 assert.equal(result.ok,false);assert.equal(writes,0);assert.match(result.error??'',/обновите|устарел/i);
});
