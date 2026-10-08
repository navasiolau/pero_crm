import { union, string, number, object, uuid, literal, NEVER, type input, type output } from 'zod';
import {priceInput,quantityInput} from '@/lib/warehouse-cost';
function decimal(read:(value:unknown)=>string){return union([string(),number()],{error:'Укажите корректное число'}).transform((value,ctx)=>{try{return read(value);}catch(error){ctx.addIssue({code:'custom',message:error instanceof Error?error.message:'Некорректное число'});return NEVER;}});}
const base={quantity:decimal(quantityInput),clientMutationId:uuid({error:'Некорректный идентификатор запроса'}).transform(value=>value.toLowerCase()),comment:string().optional()};
export const stockInventoryReceiptSchema=object({...base,receiptKind:literal('INVENTORY').default('INVENTORY'),materialId:string().min(1,'Выберите материал'),unitPrice:decimal(priceInput)}).strict();
export const stockIssueSchema=object({...base,projectMaterialId:string().min(1)}).strict();
export const stockReturnSchema=object({...base,projectMaterialId:string().min(1),sourceMovementId:string().min(1).optional(),unitPrice:decimal(priceInput).optional()}).strict().refine(value=>Boolean(value.sourceMovementId)!==(value.unitPrice!==undefined),'Выберите выдачу либо укажите положительную фактическую цену');
export const stockIncomeSchema=stockInventoryReceiptSchema;
export const stockPurchaseSchema=object({...base,
 materialId:string().min(1,'Выберите материал'),unitPrice:decimal(priceInput),
 currency:string(),cashAccountId:string().min(1,'Выберите кассу'),expenseArticleId:string().min(1,'Выберите статью расхода'),
 rate:number().positive().optional(),rateDate:string().optional(),paidAt:string().optional(),
}).strict();
export type StockPurchaseInput=input<typeof stockPurchaseSchema>;
export type StockPurchaseData=output<typeof stockPurchaseSchema>;
export type StockMaterialOption={id:string;name:string;unit:string;sku:string|null;stock?:number};