import {auth} from '@/auth';
import {prisma} from '@/lib/prisma';
import {resolveCalendarActor} from '@/lib/calendar-access';
export async function requireCalendarActor(){
 const session=await auth();
 return resolveCalendarActor(session?.user.id,id=>prisma.user.findUnique({where:{id},select:{id:true,active:true,roles:true,calendarEnabled:true}}));
}
