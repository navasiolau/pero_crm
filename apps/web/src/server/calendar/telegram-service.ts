import {NextResponse} from 'next/server';
import {authenticate,isErrorResponse} from '@/server/api/auth';
import {prisma} from '@/lib/prisma';
import {getTelegramReminderContext} from './telegram-context';
import {claimTelegramReminderCore,authorizeTelegramReminderCore,acknowledgeTelegramReminderCore} from './telegram-core';
export async function handleTelegramReminderService(request:Request,operation:'claim'|'authorize'|'ack'){
 let context;try{context=getTelegramReminderContext();}catch{return NextResponse.json({ok:false,code:'CONTEXT_UNAVAILABLE'},{status:503});}
 if(!context)return NextResponse.json({ok:false,code:'CONTEXT_OFF'},{status:503});
 const token=await authenticate(request,'calendar.reminders');if(isErrorResponse(token))return token;
 if(token.id!==context.serviceTokenId)return NextResponse.json({ok:false,code:'SERVICE_REFUSED'},{status:403});
 let input:unknown;try{const text=await request.text();if(text.length>4096)throw new Error('INPUT_BOUNDED');input=JSON.parse(text);}catch{return NextResponse.json({ok:false,code:'INPUT_INVALID'},{status:400});}
 try{const core=operation==='claim'?claimTelegramReminderCore:operation==='authorize'?authorizeTelegramReminderCore:acknowledgeTelegramReminderCore;
 const result=await core(context,input,new Date(),action=>prisma.$transaction(action,{timeout:15000,maxWait:5000}));return NextResponse.json(result,{status:result.ok?200:409});
 }catch{return NextResponse.json({ok:false,code:'OPERATION_UNCONFIRMED'},{status:503});}
}
