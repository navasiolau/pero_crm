"use server";
import {revalidatePath} from 'next/cache';
import type {Prisma,Role} from '@prisma/client';
import {auth} from '@/auth';
import {prisma} from '@/lib/prisma';
import {scopeNotificationContent} from '@/server/access/notification-visibility';
import {currentReminderNamespace,reminderNotificationWhere} from '@/server/calendar/reminder-visibility';
import {NOTIFICATION_TYPES,receivableTypesFor} from './notify';
import {canReceiveNotificationContent} from '@/lib/notification-access';
const NOTIFICATIONS_PAGE_SIZE=20;
async function notificationScope(actor:{id:string;roles:Role[]}):Promise<Prisma.NotificationWhereInput>{
 const types=NOTIFICATION_TYPES.filter(type=>type.id!=='plan.reminder'&&canReceiveNotificationContent(actor.roles,type.id)).map(type=>type.id);
 const namespace=await currentReminderNamespace(actor.id,prisma);
 return {userId:actor.id,OR:[{type:{in:types}},...(namespace?[reminderNotificationWhere(actor.id,namespace)]:[])]};
}
export async function getBellData(){
 const session=await auth();if(!session?.user)throw new Error('Не авторизован');const scope=await notificationScope(session.user);
 const [items,unread]=await Promise.all([prisma.notification.findMany({where:scope,orderBy:{createdAt:'desc'},take:10}),prisma.notification.count({where:{...scope,readAt:null}})]);
 const visible=await scopeNotificationContent(session.user,items,prisma);
 return {unread,items:visible.map(item=>({id:item.id,title:item.title,body:item.body,link:item.link,read:!!item.readAt,createdAt:item.createdAt.toISOString()}))};
}
export async function listMyNotifications(page:number){
 const session=await auth();if(!session?.user)throw new Error('Не авторизован');const safePage=Number.isFinite(page)&&page>=1?Math.floor(page):1,scope=await notificationScope(session.user);
 const [items,total]=await Promise.all([prisma.notification.findMany({where:scope,orderBy:{createdAt:'desc'},take:NOTIFICATIONS_PAGE_SIZE,skip:(safePage-1)*NOTIFICATIONS_PAGE_SIZE}),prisma.notification.count({where:scope})]);
 const visible=await scopeNotificationContent(session.user,items,prisma);
 return {total,page:safePage,pageSize:NOTIFICATIONS_PAGE_SIZE,items:visible.map(item=>({id:item.id,type:item.type,title:item.title,body:item.body,link:item.link,read:!!item.readAt,createdAt:item.createdAt.toISOString()}))};
}
export async function markAllRead():Promise<{ok:boolean}>{
 const session=await auth();if(!session?.user)throw new Error('Не авторизован');const scope=await notificationScope(session.user);
 await prisma.notification.updateMany({where:{...scope,readAt:null},data:{readAt:new Date()}});revalidatePath('/notifications');return {ok:true};
}
export async function markRead(id:string):Promise<{ok:boolean}>{
 const session=await auth();if(!session?.user)throw new Error('Не авторизован');
 const scope=await notificationScope(session.user);await prisma.notification.updateMany({where:{...scope,id},data:{readAt:new Date()}});revalidatePath('/notifications');return {ok:true};
}
export async function getMyPreferences(){
 const session=await auth();if(!session?.user)throw new Error('Не авторизован');const namespace=await currentReminderNamespace(session.user.id,prisma);
 const types=receivableTypesFor(session.user.roles).filter(type=>type.id!=='plan.reminder'||namespace!==null);
 const rows=await prisma.notificationPreference.findMany({where:{userId:session.user.id,type:{in:types.map(type=>type.id)}}});const map=new Map(rows.map(row=>[row.type,row.enabled]));
 return {prefs:types.map(type=>({id:type.id,label:type.label,enabled:map.get(type.id)??true}))};
}
export async function setPreference(type:string,enabled:boolean):Promise<{ok:boolean;error?:string}>{
 const session=await auth();if(!session?.user)throw new Error('Не авторизован');
 if(type==='plan.reminder'&&!await currentReminderNamespace(session.user.id,prisma))return {ok:false,error:'Личный план недоступен'};
 await prisma.notificationPreference.upsert({where:{userId_type:{userId:session.user.id,type}},create:{userId:session.user.id,type,enabled},update:{enabled}});revalidatePath('/notifications');return {ok:true};
}
