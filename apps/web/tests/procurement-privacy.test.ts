import assert from 'node:assert/strict';
import {test} from 'node:test';
import {canReceiveNotificationContent} from '../src/lib/notification-access';
import {scopeNotificationContent} from '../src/server/access/notification-visibility';
import {receivableTypesFor,orgRolesFor} from '../src/server/notifications/notify';
import {botAllowed,requireBotFinance,requireBotManager} from '../src/server/telegram/bot-api';

test('old operational notifications are filtered for pure accountant before content projection',async()=>{
 const items=['file.added','task.assigned','product.statusChanged','payment.added','payroll.payout'].map(type=>({type,title:'Private title',body:'Private body',link:'/products/p'}));
 const db={product:{findFirst:async()=>null},project:{findFirst:async()=>null},task:{findFirst:async()=>null}};
 const result=await scopeNotificationContent({id:'a',roles:['ACCOUNTANT']},items,db as never);
 assert.deepEqual(result.map(item=>item.type),['payment.added','payroll.payout']);assert.equal(result[0].link,'/finance');assert.equal(result[1].body,'Private body');
 assert.equal(receivableTypesFor(['ACCOUNTANT']).some(item=>item.id==='task.assigned'),false);
});
test('manager receives project commerce and own payroll but no global financial bodies; union restores finance',()=>{
 for(const type of ['payment.added','expense.added','payroll.orgAccrued','payroll.orgPayout']){assert.equal(canReceiveNotificationContent(['MANAGER'],type),false);assert.equal(orgRolesFor(type).includes('MANAGER'),false);assert.equal(canReceiveNotificationContent(['MANAGER','ACCOUNTANT'],type),true);}
 assert.equal(canReceiveNotificationContent(['MANAGER'],'project.created'),true);assert.equal(canReceiveNotificationContent(['MANAGER'],'payroll.payout'),true);assert.equal(canReceiveNotificationContent(['PROCUREMENT'],'file.added'),true);
});
test('bot financial channel does not grant operational manager writes',()=>{
 for(const roles of [['ACCOUNTANT'],['PROCUREMENT']] as const){const actor={id:'a',name:'A',source:'telegram' as const,roles:[...roles]};assert.equal(botAllowed(actor.roles),true);assert.equal(requireBotFinance(actor),null);assert.equal(requireBotManager(actor)?.status,403);}
 assert.equal(requireBotFinance({id:'m',name:'M',source:'telegram',roles:['MANAGER']})?.status,403);
});
