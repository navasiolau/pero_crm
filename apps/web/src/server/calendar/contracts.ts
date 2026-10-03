import {z} from 'zod';
const fields={title:z.string().trim().min(1,'Укажите название').max(250),description:z.string().max(10000).default(''),localDateTime:z.string().length(16),reminderOffsetMinutes:z.number().int().nullable().default(15).refine(value=>value===null||[0,15,60,1440].includes(value),'Некорректное напоминание')};
export const calendarMutationSchema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('create'),entryId:z.uuid(),...fields}).strict(),
 z.object({operation:z.literal('update'),entryId:z.uuid(),expectedRevision:z.number().int().nonnegative(),...fields}).strict(),
 z.object({operation:z.literal('state'),entryId:z.uuid(),expectedRevision:z.number().int().nonnegative(),state:z.enum(['PLANNED','COMPLETED','CANCELLED'])}).strict(),
]);
export type CalendarMutation=z.input<typeof calendarMutationSchema>;
