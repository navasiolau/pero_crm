import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveTelegramReminderContext,telegramRecipientAllowed} from '../src/lib/calendar-telegram-context';
import type {ReminderContext} from '../src/lib/calendar-reminder-context';
const web:ReminderContext={environment:'local',namespace:'local:00000000-0000-4000-8000-000000000001',testOwnerIds:['own'],enabled:true};
const env={CALENDAR_TELEGRAM_ENABLED:'true',CALENDAR_TELEGRAM_SERVICE_TOKEN_ID:'accepted-service',CALENDAR_TELEGRAM_TEST_BOT_ID:'123',CALENDAR_TELEGRAM_TEST_RECIPIENTS:JSON.stringify([{ownerId:'own',chatId:'456'}])};
test('TG defaultoff/unconfigured cannot get query context; testownerchatbotservice are exact and linked to65namespace',()=>{
 assert.equal(resolveTelegramReminderContext({},web),null);const context=resolveTelegramReminderContext(env,web);assert.ok(context);assert.equal(telegramRecipientAllowed(context,'own','456'),true);assert.equal(telegramRecipientAllowed(context,'foreign','456'),false);assert.equal(telegramRecipientAllowed(context,'own','-456'),false);
 for(const changed of [{CALENDAR_TELEGRAM_TEST_BOT_ID:''},{CALENDAR_TELEGRAM_SERVICE_TOKEN_ID:''},{CALENDAR_TELEGRAM_TEST_RECIPIENTS:'[]'},{CALENDAR_TELEGRAM_TEST_RECIPIENTS:JSON.stringify([{ownerId:'foreign',chatId:'456'}])},{CALENDAR_TELEGRAM_TEST_RECIPIENTS:JSON.stringify([{ownerId:'own',chatId:'-456'}])}])assert.throws(()=>resolveTelegramReminderContext({...env,...changed},web));
 assert.throws(()=>resolveTelegramReminderContext(env,{...web,enabled:false}));
});
