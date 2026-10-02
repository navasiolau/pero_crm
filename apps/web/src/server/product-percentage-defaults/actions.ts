"use server";
import {auth} from '@/auth';
import {withTaskTransaction} from '@/server/tasks/transaction';
import {saveProductPercentageDefaults} from './core';
import type {DefaultsResult} from './contracts';
export async function saveProductPercentageDefaultsAction(input:unknown):Promise<DefaultsResult>{
 const session=await auth();if(!session?.user)return{ok:false,kind:'forbidden',error:'Не авторизован'};
 try{return await withTaskTransaction(tx=>saveProductPercentageDefaults({id:session.user.id,name:session.user.name??'',roles:session.user.roles,source:'web'},input,tx));}
 catch(error){return{ok:false,kind:'failure',error:error instanceof Error?error.message:'Не удалось сохранить стандартные проценты'};}
}
