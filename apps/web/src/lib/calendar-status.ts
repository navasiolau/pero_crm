import type {CalendarEntryState} from '@prisma/client';
export const calendarStateLabels:Record<CalendarEntryState,string>={PLANNED:'Запланировано',COMPLETED:'Выполнено',CANCELLED:'Отменено'};
