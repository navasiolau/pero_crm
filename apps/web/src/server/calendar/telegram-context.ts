import {getReminderContext} from './reminder-context';
import {resolveTelegramReminderContext} from '@/lib/calendar-telegram-context';
export function getTelegramReminderContext(){if(process.env.CALENDAR_TELEGRAM_ENABLED!=='true')return null;return resolveTelegramReminderContext(process.env,getReminderContext());}
