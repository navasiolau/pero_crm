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
