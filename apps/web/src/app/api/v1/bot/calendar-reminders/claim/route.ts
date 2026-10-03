import {handleTelegramReminderService} from '@/server/calendar/telegram-service';
export async function POST(request:Request){return handleTelegramReminderService(request,'claim');}
