import type {Prisma,PrismaClient} from "@prisma/client";
export async function calendarBaseline(db:PrismaClient){
 const result:Record<string,unknown>={};
 for(const table of ["User","CalendarEntry","CalendarReminderFact","TelegramReminderOutbox","Notification","TimeEntry","Task"])
  result[table]=await db.$queryRawUnsafe(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) AS digest FROM "${table}" t`);
 return result;
}
export async function createCalendarUsers(tx:Prisma.TransactionClient,marker:string){
 const own=await tx.user.create({data:{id:marker,email:marker+"@invalid.local",name:"QA Личный план",passwordHash:"qa-login-disabled",roles:["PROCUREMENT"],calendarEnabled:true}});
 const other=await tx.user.create({data:{id:marker+"-other",email:marker+"-other@invalid.local",name:"QA Другой владелец",passwordHash:"qa-login-disabled",roles:["ADMIN"],calendarEnabled:true}});
 return {own,other};
}
export async function deleteCalendarUsers(tx:Prisma.TransactionClient,marker:string){
 const owners=[marker,marker+"-other"];
 await tx.calendarEntry.deleteMany({where:{ownerId:{in:owners}}});
 await tx.user.deleteMany({where:{id:{in:owners},email:{in:owners.map(id=>id+"@invalid.local")}}});
}
