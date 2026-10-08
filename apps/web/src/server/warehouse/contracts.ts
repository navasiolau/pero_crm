import {z} from 'zod';
import {priceInput,quantityInput} from '@/lib/warehouse-cost';
function decimal(read:(value:unknown)=>string){return z.union([z.string(),z.number()],{error:'Укажите корректное число'}).transform((value,ctx)=>{try{return read(value);}catch(error){ctx.addIssue({code:'custom',message:error instanceof Error?error.message:'Некорректное число'});return z.NEVER;}});}
const base={quantity:decimal(quantityInput),clientMutationId:z.uuid({error:'Некорректный идентификатор запроса'}),comment:z.string().optional()};
export const stockInventoryReceiptSchema=z.object({...base,receiptKind:z.literal('INVENTORY').default('INVENTORY'),materialId:z.string().min(1,'Выберите материал'),unitPrice:decimal(priceInput)}).strict();
export const stockIssueSchema=z.object({...base,projectMaterialId:z.string().min(1)}).strict();
export const stockReturnSchema=z.object({...base,projectMaterialId:z.string().min(1),sourceMovementId:z.string().min(1).optional(),unitPrice:decimal(priceInput).optional()}).strict().refine(input=>Boolean(input.sourceMovementId)!==(input.unitPrice!==undefined),'Выберите выдачу либо укажите положительную фактическую цену');

// Backward-compatible name; one validator.
export const stockIncomeSchema=stockInventoryReceiptSchema;
