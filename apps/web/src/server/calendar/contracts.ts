import {string,number,object,uuid,literal,discriminatedUnion,enum as enumValues,type input} from 'zod';
import {MAX_PLANNED_MINUTES} from '@/lib/calendar-duration';
import {calendarDateRange} from '@/lib/calendar-dates';
const fields={title:string().trim().min(1,'Укажите название').max(250),description:string().max(10000).default(''),localDateTime:string().length(16),plannedMinutes:number().int().min(0).max(MAX_PLANNED_MINUTES).nullable().optional(),reminderOffsetMinutes:number().int().nullable().default(15).refine(value=>value===null||[0,15,60,1440].includes(value),'Некорректное напоминание')};
export const calendarMutationSchema=discriminatedUnion('operation',[
 object({operation:literal('create'),entryId:uuid(),...fields}).strict(),
 object({operation:literal('update'),entryId:uuid(),expectedRevision:number().int().nonnegative(),...fields}).strict(),
 object({operation:literal('state'),entryId:uuid(),expectedRevision:number().int().nonnegative(),state:enumValues(['PLANNED','COMPLETED','CANCELLED'])}).strict(),
]);
export type CalendarMutation=input<typeof calendarMutationSchema>;
export const calendarAnalyticsQuerySchema=object({from:string().length(10),to:string().length(10)}).strict();
export type CalendarAnalyticsQuery=input<typeof calendarAnalyticsQuerySchema>;
export function parseCalendarAnalyticsQuery(value:unknown){
 const query=calendarAnalyticsQuerySchema.parse(value);
 return {query,range:calendarDateRange(query.from,query.to)};
}
