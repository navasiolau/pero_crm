import {NextResponse} from 'next/server';
import {authenticate,isErrorResponse} from '@/server/api/auth';
import {dispatchCalendarReminders} from '@/server/calendar/reminder-worker';
export async function POST(request:Request){
 const auth=await authenticate(request,'calendar.reminders');if(isErrorResponse(auth))return auth;
 if((await request.text()).trim())return NextResponse.json({error:'Параметры доставки не принимаются'},{status:400});
 try{return NextResponse.json({ok:true,...await dispatchCalendarReminders()});}catch{return NextResponse.json({ok:false,error:'Доставка напоминаний не подтверждена'},{status:503});}
}
