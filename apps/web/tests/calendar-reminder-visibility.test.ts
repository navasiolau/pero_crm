import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const id=require.resolve(name),stub=new Module(id);stub.filename=id;stub.loaded=true;stub.exports=exports;require.cache[id]=stub;}
const actor={id:'acct',roles:['ACCOUNTANT']};let enabled=true,namespace='local:00000000-0000-4000-8000-000000000001';
const facts=[{webNotificationId:'own',ownerId:'acct',namespace,webState:'DELIVERED',entry:{ownerId:'acct'}},{webNotificationId:'foreign-scope',ownerId:'other',namespace,webState:'DELIVERED',entry:{ownerId:'other'}},{webNotificationId:'imported',ownerId:'acct',namespace:'production',webState:'DELIVERED',entry:{ownerId:'acct'}}];
const rows=['own','foreign-scope','imported','unconfirmed','operational','finance'].map(id=>({id,userId:'acct',type:id==='operational'?'task.assigned':id==='finance'?'payment.added':'plan.reminder',title:id,body:'Private',link:id==='finance'?'/projects/hidden':'/plan?date=2026-10-03',readAt:null,createdAt:new Date('2026-10-03T09:00Z')}));let preferenceWrites=0;
type Scope={userId?:string;type?:{in:string[]}|string;OR?:Scope[];calendarReminderFact?:{is:{namespace:string;ownerId:string;webState:string}}};
function allowed(row:typeof rows[number],scope:Scope):boolean{
 if(scope.userId&&scope.userId!==row.userId)return false;
 if(scope.OR&&!scope.OR.some(child=>allowed(row,child)))return false;
 if(scope.type&&(typeof scope.type==='string'?scope.type!==row.type:!scope.type.in.includes(row.type)))return false;
 if(scope.calendarReminderFact){const wanted=scope.calendarReminderFact.is;return facts.some(fact=>fact.webNotificationId===row.id&&fact.ownerId===wanted.ownerId&&fact.namespace===wanted.namespace&&fact.webState===wanted.webState&&fact.entry.ownerId===actor.id);}
 return true;
}
const db={user:{findUnique:async()=>({active:true,roles:['ACCOUNTANT'],calendarEnabled:enabled})},calendarReminderFact:{findMany:async({where}:{where:{ownerId:string;namespace:string;webNotificationId:{in:string[]}}})=>facts.filter(fact=>fact.ownerId===where.ownerId&&fact.namespace===where.namespace&&where.webNotificationId.in.includes(fact.webNotificationId))},notification:{findMany:async({where}:{where:Scope})=>rows.filter(row=>allowed(row,where)),count:async({where}:{where:Scope})=>rows.filter(row=>allowed(row,where)).length},notificationPreference:{findMany:async()=>[],upsert:async({where}:{where:{userId_type:{userId:string;type:string}}})=>{assert.equal(where.userId_type.userId,actor.id);preferenceWrites++;}},product:{findFirst:async()=>null},project:{findFirst:async()=>null},task:{findMany:async()=>[],findFirst:async()=>null}};
inject('../src/auth',{auth:async()=>({user:actor})});inject('../src/lib/prisma',{prisma:db});inject('next/cache',{revalidatePath:()=>{}});inject('../src/server/calendar/reminder-context',{getReminderContext:()=>({environment:'local',namespace,testOwnerIds:['acct'],enabled:true})});
const {getBellData,listMyNotifications,getMyPreferences,setPreference}=require('../src/server/notifications/actions') as typeof import('../src/server/notifications/actions');
test('pure ACCOUNTANT sees exactown confirmedplan and finance, never operational/foreign/unconfirmed/productionimport',async()=>{
 const bell=await getBellData();assert.deepEqual(bell.items.map(row=>row.id),['own','finance']);assert.equal(bell.unread,2);assert.equal(bell.items[1].link,'/finance');
 const feed=await listMyNotifications(1);assert.equal(feed.total,2);assert.deepEqual(feed.items.map(row=>row.id),['own','finance']);assert.ok((await getMyPreferences()).prefs.some(pref=>pref.id==='plan.reminder'));
 assert.equal((await setPreference('plan.reminder',false)).ok,true);assert.equal(preferenceWrites,1);
});
test('current flag or trusted namespace revoked hides own reminder and denies reminder setting, preserves finance',async()=>{
 enabled=false;assert.deepEqual((await getBellData()).items.map(row=>row.id),['finance']);assert.equal((await setPreference('plan.reminder',true)).ok,false);assert.equal(preferenceWrites,1);assert.ok(!(await getMyPreferences()).prefs.some(pref=>pref.id==='plan.reminder'));
 enabled=true;namespace='local:00000000-0000-4000-8000-000000000002';assert.deepEqual((await getBellData()).items.map(row=>row.id),['finance']);
});
