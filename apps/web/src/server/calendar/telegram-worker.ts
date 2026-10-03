import {prisma} from '@/lib/prisma';
import {getTelegramReminderContext} from './telegram-context';
import {queueTelegramRemindersCore} from './telegram-core';
export async function queuePendingTelegramReminders(){const context=getTelegramReminderContext();if(!context)return 0;return queueTelegramRemindersCore(context,new Date(),operation=>prisma.$transaction(operation,{timeout:15000,maxWait:5000}));}
