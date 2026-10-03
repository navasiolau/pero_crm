import {prisma} from '@/lib/prisma';
import {getReminderContext} from './reminder-context';
import {dispatchCalendarRemindersCore} from './reminders';
const workerState=globalThis as typeof globalThis & {calendarReminderWorker?:{timer:ReturnType<typeof setInterval>;running:boolean}};
export async function dispatchCalendarReminders(){
 const context=getReminderContext();if(!context?.enabled)return {delivered:0,suppressed:0,skipped:0,repeated:0};
 return dispatchCalendarRemindersCore(context,new Date(),operation=>prisma.$transaction(operation,{timeout:15000,maxWait:5000}));
}
/** Только register() существующего node web process запускает interval; импорт сам ничего не запускает. */
export function startCalendarReminderWorker(){
 if(workerState.calendarReminderWorker)return;
 const context=getReminderContext();if(!context?.enabled)return;
 const state={timer:undefined as unknown as ReturnType<typeof setInterval>,running:false};
 const tick=async()=>{if(state.running)return;state.running=true;try{await dispatchCalendarReminders();}catch{console.error('[calendar-reminders] delivery failed; next tick will retry');}finally{state.running=false;}};
 state.timer=setInterval(()=>{void tick();},60000);state.timer.unref?.();workerState.calendarReminderWorker=state;void tick();
}
