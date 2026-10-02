"use server";
import {auth} from '@/auth';
import {patchProjectStageCore} from './stage-service';
export async function patchProjectStage(input:unknown){
 const session=await auth();
 if(!session?.user)return{ok:false,kind:'forbidden' as const,error:'Не авторизован'};
 return patchProjectStageCore({id:session.user.id,name:session.user.name??'',roles:session.user.roles,source:'web'},input);
}
