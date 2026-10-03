import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const id=require.resolve(name),stub=new Module(id);stub.filename=id;stub.loaded=true;stub.exports=exports;require.cache[id]=stub;}
let allowed=true;const updates:Record<string,unknown>[]=[];
const before={id:'actor',email:'test@example.invalid',name:'Actor',roles:['WORKER'],active:true,calendarEnabled:true,payScheme:'NONE',payPercent:null};
inject('../src/server/require-role',{requireAdmin:async()=>{if(!allowed)throw new Error('ADMIN_REQUIRED');return {user:{id:'admin',name:'Admin'}};}});
inject('../src/lib/prisma',{prisma:{user:{findUnique:async()=>before,findFirst:async()=>null,update:async({data}:{data:Record<string,unknown>})=>{updates.push(data);return {...before,...data};}}}});
inject('../src/server/plugins/changelog',{writeChangeLog:async()=>{}});
inject('../src/server/notifications/notify',{notifyPerson:async()=>{}});
inject('next/cache',{revalidatePath:()=>{}});
const {updateUser}=require('../src/server/users/actions') as typeof import('../src/server/users/actions');
const input={email:before.email,name:before.name,roles:['ENGINEER'] as const,payScheme:'NONE' as const,active:true};
test('role-only admin edits retain prior override; explicit NULL resets inheritance',async()=>{
 updates.length=0;
 assert.equal((await updateUser('actor',{...input,roles:[...input.roles]})).ok,true);
 assert.equal(Object.hasOwn(updates[0],'calendarEnabled'),false);
 for(const calendarEnabled of [null,false,true]){assert.equal((await updateUser('actor',{...input,roles:[...input.roles],calendarEnabled})).ok,true);assert.equal(updates.at(-1)?.calendarEnabled,calendarEnabled);}
});
test('non-admin cannot change calendar flag and malformed override causes no update',async()=>{
 const count=updates.length;allowed=false;
 await assert.rejects(()=>updateUser('actor',{...input,roles:[...input.roles],calendarEnabled:true}),/ADMIN_REQUIRED/);
 allowed=true;assert.equal((await updateUser('actor',{...input,roles:[...input.roles],calendarEnabled:'true'} as never)).ok,false);
 assert.equal(updates.length,count);
});
