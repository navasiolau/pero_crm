import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {resolveReminderContext,reminderOwnerAllowed} from '../src/lib/calendar-reminder-context';
const owner='own-test',namespace=`local:${randomUUID()}`;
const base={CALENDAR_REMINDER_ENVIRONMENT:'local',CALENDAR_REMINDER_NAMESPACE:namespace,CALENDAR_REMINDER_TEST_OWNER_IDS:JSON.stringify([owner]),CALENDAR_REMINDERS_ENABLED:'true',AUTH_URL:'http://localhost:3019',DATABASE_URL:'postgresql://test:test@127.0.0.1:5433/pero_crm',S3_BUCKET:''};
test('explicit context localnamespace and exact owners are mandatory; production imports never become local namespace',()=>{
 const context=resolveReminderContext(base,{platform:'win32',container:false});assert.ok(context);assert.equal(reminderOwnerAllowed(context,owner),true);assert.equal(reminderOwnerAllowed(context,'imported-user'),false);
 assert.equal(resolveReminderContext({}, {platform:'win32',container:false}),null);
 for(const changed of [{CALENDAR_REMINDER_NAMESPACE:'production'},{CALENDAR_REMINDER_TEST_OWNER_IDS:'[]'},{DATABASE_URL:'postgresql://test:test@prod:5433/pero_crm'},{AUTH_URL:'https://crm.peromebel.by'},{CALENDAR_REMINDER_TEST_OWNER_IDS:JSON.stringify([owner,owner])}])assert.throws(()=>resolveReminderContext({...base,...changed},{platform:'win32',container:false}));
});
test('staging is isolated by pinned origin bucket db and explicit owner namespace; disabled preserves context without enabling delivery',()=>{
 const staged={...base,CALENDAR_REMINDER_ENVIRONMENT:'staging',CALENDAR_REMINDER_NAMESPACE:`staging:${randomUUID()}`,AUTH_URL:'https://staging-crm.peromebel.by',DATABASE_URL:'postgresql://test:test@db:5432/crm',S3_BUCKET:'pero-crm-staging'};
 assert.equal(resolveReminderContext(staged,{platform:'linux',container:true})?.environment,'staging');assert.throws(()=>resolveReminderContext({...staged,S3_BUCKET:'pero-crm'},{platform:'linux',container:true}));
 const disabled=resolveReminderContext({...base,CALENDAR_REMINDERS_ENABLED:'false'},{platform:'win32',container:false});assert.ok(disabled&&!disabled.enabled);
});

test('dedicated staging origin works when both auth aliases are absent; empty aliases choose next nonempty',()=>{
 const stage={...base,CALENDAR_REMINDER_ENVIRONMENT:'staging',CALENDAR_REMINDER_NAMESPACE:`staging:${randomUUID()}`,AUTH_URL:undefined,DATABASE_URL:'postgresql://test:test@db:5432/crm',S3_BUCKET:'pero-crm-staging'};
 const runtime={platform:'linux',container:true};
 assert.equal(resolveReminderContext({...stage,CALENDAR_REMINDERS_PUBLIC_ORIGIN:'https://staging-crm.peromebel.by'},runtime)?.enabled,true);
 assert.equal(resolveReminderContext({...stage,CALENDAR_REMINDERS_PUBLIC_ORIGIN:' ',AUTH_URL:'',NEXTAUTH_URL:'https://staging-crm.peromebel.by'},runtime)?.environment,'staging');
});

test('explicit reminder origin remains guarded without auth-origin changes or unsafe fallback',()=>{
 const runtime={platform:'win32',container:false};
 for(const origin of ['https://crm.peromebel.by','http://user:pass@localhost:3019','http://localhost:3019/path','http://localhost:3019?x=1','http://localhost:3019#x']) assert.throws(()=>resolveReminderContext({...base,CALENDAR_REMINDERS_PUBLIC_ORIGIN:origin},runtime));
 assert.throws(()=>resolveReminderContext({...base,AUTH_URL:undefined,NEXTAUTH_URL:' ',CALENDAR_REMINDERS_PUBLIC_ORIGIN:''},runtime));
 const prod={CALENDAR_REMINDER_ENVIRONMENT:'production',CALENDAR_REMINDER_NAMESPACE:'production',CALENDAR_REMINDERS_ENABLED:'true',CALENDAR_REMINDERS_PUBLIC_ORIGIN:'https://crm.peromebel.by',DATABASE_URL:'postgresql://test:test@db:5432/crm',S3_BUCKET:'pero-crm'};
 assert.equal(resolveReminderContext(prod,{platform:'linux',container:true})?.environment,'production');
 assert.throws(()=>resolveReminderContext({...prod,S3_BUCKET:'pero-crm-staging'},{platform:'linux',container:true}));
});
