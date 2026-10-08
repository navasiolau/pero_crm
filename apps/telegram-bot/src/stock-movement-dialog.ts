import { randomUUID } from "node:crypto";
import { crm, CrmError, type StockChoice } from "./crm";
import { dialogChoices, dialogChoice, positiveDecimalDraft, CANCEL_ROW, type DialogContext } from "./dialog-choices";
export type StockMovementDialog = {
 kind:"stockMovement"; operation:"INCOME"|"EXPENSE"|"RETURN";step:"product"|"material"|"source"|"quantity"|"price"|"comment"|"confirm";
 clientMutationId:string;product?:StockChoice;item?:StockChoice;choices?:StockChoice[];choiceToken?:string;quantity?:string;unitPrice?:string;comment?:string;busy?:boolean;
};
type Context=DialogContext<StockMovementDialog>;
const labels={INCOME:"Инвентарный приход",EXPENSE:"Выдача на изделие",RETURN:"Возврат на склад"};
export async function startStockMovement(ctx:Context,chatId:number,operation:StockMovementDialog["operation"]){
 const dialog:StockMovementDialog={kind:"stockMovement",operation,step:operation==="INCOME"?"material":"product",clientMutationId:randomUUID()};
 ctx.setDialog(chatId,dialog);
 await ctx.reply(chatId,labels[operation]+". "+(operation==="INCOME"?"Введите название или артикул материала:":"Введите номер или название изделия:"),[CANCEL_ROW]);
}
async function choices(ctx:Context,chatId:number,actorId:string,dialog:StockMovementDialog,text?:string){
 const kind=dialog.step==="product"?"products":dialog.step==="source"?"sources":"materials";
 const result=await crm.stockChoices(actorId,kind,{q:text,productId:dialog.product?.id,income:dialog.operation==="INCOME"});
 if(ctx.getDialog(chatId)!==dialog)return;
 if(!result.ok){await ctx.reply(chatId,result.error??"Не удалось загрузить варианты. Повторите поиск.");return;}
 dialog.choices=result.items??[];
 const choice=dialogChoices("sw",dialog.clientMutationId,dialog.choices,item=>item.label+(item.available===undefined||dialog.operation==="INCOME"?"":` · ${item.available} ${item.unit??""}`));
 dialog.choiceToken=choice.token;
 if(!dialog.choices.length){await ctx.reply(chatId,"Подходящих записей нет. Уточните поиск или отмените операцию.",[CANCEL_ROW]);return;}
 await ctx.reply(chatId,dialog.step==="product"?"Выберите изделие:":dialog.step==="source"?"Исходная выдача:":"Выберите материал:",[...choice.buttons,CANCEL_ROW]);
}
async function confirm(ctx:Context,chatId:number,dialog:StockMovementDialog){
 dialog.step="confirm";
 const text=[labels[dialog.operation],...(dialog.product?["Изделие: "+dialog.product.label]:[]),"Материал: "+dialog.item?.label,`Количество: ${dialog.quantity} ${dialog.item?.unit??""}`];
 if(dialog.unitPrice)text.push("Цена: "+dialog.unitPrice+" BYN");
 else if(dialog.item?.unitPrice)text.push("Цена исходной выдачи: "+dialog.item.unitPrice+" BYN");
 if(dialog.operation==="INCOME")text.push("Деньги из кассы не списываются.");
 if(dialog.comment)text.push("Комментарий: "+dialog.comment);
 await ctx.reply(chatId,text.join("\n"),[[{text:"✅ Провести",callback_data:`sw:${dialog.clientMutationId}:ok`}],CANCEL_ROW]);
}
export async function stockMovementText(ctx:Context,chatId:number,actorId:string,dialog:StockMovementDialog,text:string){
 if(dialog.busy)return;dialog.busy=true;
 try{
  if(["product","material","source"].includes(dialog.step)){await choices(ctx,chatId,actorId,dialog,text);return;}
  if(dialog.step==="quantity"){
   const maximum=dialog.operation==="INCOME"?Infinity:dialog.item?.available??0;
   if(!positiveDecimalDraft(text,3)||Number(text.replace(",","."))>maximum){await ctx.reply(chatId,`Укажите положительное количество${Number.isFinite(maximum)?" не больше "+maximum:""} (до 3 знаков после запятой):`);return;}
   dialog.quantity=text;
   dialog.step=dialog.operation==="INCOME"||dialog.item?.legacyLineId?"price":"comment";
   await ctx.reply(chatId,dialog.step==="price"?(dialog.item?.legacyLineId?"Исторический остаток без снимка. Фактическая цена единицы, BYN:":"Цена единицы, BYN:"):"Комментарий («—» — без комментария):",[CANCEL_ROW]);return;
  }
  if(dialog.step==="price"){
   if(!positiveDecimalDraft(text,2)){await ctx.reply(chatId,"Укажите положительную цену с точностью до копейки:");return;}
   dialog.unitPrice=text;dialog.step="comment";await ctx.reply(chatId,"Комментарий («—» — без комментария):",[CANCEL_ROW]);return;
  }
  if(dialog.step==="comment"){dialog.comment=["—","-"].includes(text)?undefined:text;await confirm(ctx,chatId,dialog);return;}
  await ctx.reply(chatId,"Подтвердите операцию кнопкой или отмените её.",[CANCEL_ROW]);
 }finally{dialog.busy=false;}
}
export async function stockMovementCallback(ctx:Context,chatId:number,actorId:string,dialog:StockMovementDialog|undefined,args:string[]){
 if(!dialog||args[0]!==dialog.clientMutationId){await ctx.reply(chatId,"Кнопка устарела — начните складскую операцию заново.");return;}
 if(dialog.busy)return;dialog.busy=true;
 try{
  if(args[1]==="pick"){
   const item=dialogChoice(dialog.choiceToken,dialog.choices,args[2],args[3]);
   if(!item||!["product","material","source"].includes(dialog.step)){await ctx.reply(chatId,"Выбор устарел — используйте последние кнопки.");return;}
   dialog.choices=undefined;dialog.choiceToken=undefined;
   if(dialog.step==="product"){
    dialog.product=item;dialog.step=dialog.operation==="RETURN"?"source":"material";
    if(dialog.step==="source")await choices(ctx,chatId,actorId,dialog);
    else await ctx.reply(chatId,"Введите название или артикул материала:",[CANCEL_ROW]);return;
   }
   dialog.item=item;dialog.step="quantity";await ctx.reply(chatId,`Количество на всю партию, ${item.unit??"ед."}:`,[CANCEL_ROW]);return;
  }
  if(args[1]!=="ok"||dialog.step!=="confirm"||!dialog.item||!dialog.quantity){await ctx.reply(chatId,"Сначала завершите ввод.");return;}
  const common={kind:dialog.operation,clientMutationId:dialog.clientMutationId,quantity:dialog.quantity,...(dialog.comment?{comment:dialog.comment}:{})};
  const input=dialog.operation==="INCOME"?{...common,materialId:dialog.item.id,unitPrice:dialog.unitPrice,receiptKind:"INVENTORY"}
   :dialog.operation==="EXPENSE"?{...common,productId:dialog.product!.id,materialId:dialog.item.id}
   :dialog.item.legacyLineId?{...common,projectMaterialId:dialog.item.legacyLineId,unitPrice:dialog.unitPrice}
   :{...common,productId:dialog.product!.id,sourceMovementId:dialog.item.id};
  try{
   const result=await crm.createStockMovement(actorId,input);
   if(result.ok){if(ctx.getDialog(chatId)===dialog)ctx.setDialog(chatId,null);await ctx.reply(chatId,"✅ "+(dialog.operation==="EXPENSE"?"Материал выдан на изделие":dialog.operation==="RETURN"?"Материал возвращён на склад":"Инвентарный приход проведён"));}
   else await ctx.reply(chatId,`❌ ${result.error??"Операция не проведена"}. Данные сохранены — повторите подтверждение или отмените.`);
  }catch(error){await ctx.reply(chatId,`❌ ${error instanceof CrmError?error.message:"Ответ не получен"}. Повторите подтверждение: идентификатор операции сохранён.`);}
 }finally{dialog.busy=false;}
}
