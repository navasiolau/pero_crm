import {z} from 'zod';
import type {Prisma,Role} from '@prisma/client';
import {FINANCE_ROLES,hasAnyRole} from '@/lib/roles';
import {parseExpenseArticleCode,nextExpenseArticleCode} from '@/lib/expense-article-code';
export const articleSchema=z.object({name:z.string().trim().min(1,'Укажите название статьи'),comment:z.string().optional(),code:z.string().optional()}).strict();
export type ExpenseArticleInput=z.input<typeof articleSchema>;
type Actor={id:string;name?:string|null;roles:readonly Role[]};
export async function createExpenseArticleCore(actor:Actor,input:unknown,tx:Prisma.TransactionClient){
 if(!hasAnyRole([...actor.roles],FINANCE_ROLES))return{ok:false as const,error:'Недостаточно прав'};
 const parsed=articleSchema.safeParse(input);if(!parsed.success)return{ok:false as const,error:parsed.error.issues[0]?.message??'Ошибка данных'};
 let code:number;try{code=parsed.data.code===undefined?nextExpenseArticleCode((await tx.expenseArticle.aggregate({_max:{code:true}}))._max.code):parseExpenseArticleCode(parsed.data.code);}catch(error){return{ok:false as const,error:error instanceof Error?error.message:'Проверьте код статьи'};}
 if(await tx.expenseArticle.findUnique({where:{code},select:{id:true}}))return{ok:false as const,error:`Код статьи ${code} уже используется`};
 const article=await tx.expenseArticle.create({data:{code,name:parsed.data.name,comment:parsed.data.comment?.trim()||null}});
 await tx.changeLog.create({data:{actorType:'user',actorId:actor.id,actorName:actor.name??undefined,entity:'expenseArticle',entityId:article.id,action:'create',newValue:{code:article.code,name:article.name,comment:article.comment}}});
 return{ok:true as const,article};
}
export async function toggleExpenseArticleCore(actor:Actor,articleId:string,tx:Prisma.TransactionClient){
 if(!hasAnyRole([...actor.roles],FINANCE_ROLES))return{ok:false as const,error:'Недостаточно прав'};
 const article=await tx.expenseArticle.findUnique({where:{id:articleId}});if(!article)return{ok:false as const,error:'Статья не найдена'};
 await tx.expenseArticle.update({where:{id:articleId},data:{active:!article.active}});
 await tx.changeLog.create({data:{actorType:'user',actorId:actor.id,actorName:actor.name??undefined,entity:'expenseArticle',entityId:articleId,action:'update',field:'active',oldValue:article.active,newValue:!article.active}});return{ok:true as const};
}
export function expenseArticleCreateError(error:unknown):string{
 if(error&&typeof error==='object'&&'code'in error&&error.code==='P2002'&&'meta'in error){const target=(error.meta as {target?:unknown})?.target;if((Array.isArray(target)&&target.some(item=>String(item).includes('code')))||typeof target==='string'&&target.includes('code'))return'Этот код статьи уже используется';}
 return'Не удалось создать статью';
}
