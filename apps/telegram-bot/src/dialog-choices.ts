import { randomUUID } from "node:crypto";
import type { InlineButton } from "./tg";
export type DialogContext<T> = {
 reply:(chatId:number,text:string,buttons?:InlineButton[][])=>Promise<void>;
 getDialog:(chatId:number)=>unknown;
 setDialog:(chatId:number,dialog:T|null)=>void;
};
export const CANCEL_ROW:InlineButton[]=[{text:"❌ Отмена",callback_data:"cancel"}];
export function dialogChoices<T extends {label:string;currency?:string}>(prefix:string,id:string,items:T[],label=(item:T)=>item.label+(item.currency?" · "+item.currency:"")){
 const token=randomUUID().slice(0,8);
 return {token,buttons:items.map((item,index)=>[{text:label(item),callback_data:`${prefix}:${id}:pick:${token}:${index}`}])};
}
export function dialogChoice<T>(token:string|undefined,items:readonly T[]|undefined,suppliedToken:string,index:string|undefined):T|undefined{
 if(!token||suppliedToken!==token||!/^\d+$/.test(index??""))return undefined;
 return items?.[Number(index)];
}
export function positiveDecimalDraft(text:string,places:number){
 const value=Number(text.replace(",","."));
 return new RegExp(`^\\d+(?:[.,]\\d{1,${places}})?$`).test(text)&&Number.isFinite(value)&&value>0;
}
