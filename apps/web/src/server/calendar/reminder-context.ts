import {existsSync} from 'node:fs';
import {resolveReminderContext} from '@/lib/calendar-reminder-context';
export function getReminderContext(){return resolveReminderContext(process.env,{platform:process.platform,container:existsSync('/.dockerenv')});}
