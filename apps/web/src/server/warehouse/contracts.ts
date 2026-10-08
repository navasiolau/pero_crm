import { union, string, number, object, uuid, literal, NEVER, type input, type output } from 'zod';
import {priceInput,quantityInput} from '@/lib/warehouse-cost';
import type {ViewableFile} from '@/lib/viewable-file';
function decimal(read:(value:unknown)=>string){return union([string(),number()],{error:'Укажите корректное число'}).transform((value,ctx)=>{try{return read(value);}catch(error){ctx.addIssue({code:'custom',message:error instanceof Error?error.message:'Некорректное число'});return NEVER;}});}
const base={quantity:decimal(quantityInput),clientMutationId:uuid({error:'Некорректный идентификатор запроса'}).transform(value=>value.toLowerCase()),comment:string().optional()};
export const stockInventoryReceiptSchema=object({...base,receiptKind:literal('INVENTORY').default('INVENTORY'),materialId:string().min(1,'Выберите материал'),unitPrice:decimal(priceInput)}).strict();
export const stockIssueSchema=object({...base,projectMaterialId:string().min(1).optional(),productId:string().min(1).optional(),materialId:string().min(1).optional()}).strict().refine(value=>Boolean(value.projectMaterialId) ? !value.productId&&!value.materialId : Boolean(value.productId&&value.materialId),'Выберите изделие и материал либо строку потребности');
export const stockReturnSchema=object({...base,projectMaterialId:string().min(1).optional(),productId:string().min(1).optional(),sourceMovementId:string().min(1).optional(),unitPrice:decimal(priceInput).optional()}).strict().refine(value=>Boolean(value.projectMaterialId)!==Boolean(value.productId),'Выберите изделие либо строку потребности').refine(value=>Boolean(value.sourceMovementId)!==(value.unitPrice!==undefined),'Выберите выдачу либо укажите положительную фактическую цену').refine(value=>!value.productId||Boolean(value.sourceMovementId),'Прямой возврат требует исходную выдачу');
export const stockIncomeSchema=stockInventoryReceiptSchema;
export const stockPurchaseSchema=object({...base,
 materialId:string().min(1,'Выберите материал'),unitPrice:decimal(priceInput),
 currency:string(),cashAccountId:string().min(1,'Выберите кассу'),expenseArticleId:string().min(1,'Выберите статью расхода'),
 rate:number().positive().optional(),rateDate:string().optional(),paidAt:string().optional(),reportDocumentId:string().min(1).optional(),
}).strict();
export type StockPurchaseInput=input<typeof stockPurchaseSchema>;
export type StockPurchaseData=output<typeof stockPurchaseSchema>;
export type StockMaterialOption={id:string;name:string;unit:string;sku:string|null;stock?:number};
// Canonical read contracts shared by server loaders, CRM and bot adapters.
export type WarehouseReturnSource = {
 id:string;materialId:string;materialName:string;unit:string;createdAt:string;quantity:number;unitPrice:string|null;
};
export type StockMovementView = {
 id:string;type:"INCOME"|"EXPENSE"|"RETURN";receiptKind:"INVENTORY"|"PAID"|null;
 materialId:string;materialName:string;materialUnit:string;quantity:number;unitPrice:number|null;totalByn:number|null;
 productId:string|null;productNumber:string|null;comment:string|null;createdByName:string|null;createdAt:string;
 returnableQuantity?:number|null;
 reportDocument?:ViewableFile|null;
};
export type ProjectMaterialLineStatus="FULFILLED"|"AVAILABLE"|"SHORTAGE";
export type ProjectMaterialLine = {
 id:string;materialId:string;materialName:string;materialSku:string|null;unit:string;purchasePrice:number|null;
 quantityPerUnit:number;quantity:number;issuedQty:number;debt:number;available:number;status:ProjectMaterialLineStatus;
 comment:string|null;warehouseReady:boolean;returnSources:WarehouseReturnSource[];legacyReturnQuantity:number;
};
export type ProjectMaterialsData = {
 lines:ProjectMaterialLine[];movements:StockMovementView[];materialsTotalByn:number|null;hasShortage:boolean;
 returnSources:WarehouseReturnSource[];warehouseReady:boolean;
};
export type MaterialOption = {
 id:string;name:string;sku:string|null;unit:string;purchasePrice:number|null;stock:number;
};
