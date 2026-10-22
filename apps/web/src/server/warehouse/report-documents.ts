import type {Prisma} from '@prisma/client';
import {activeStockMovementWhere} from './active-records';
import {activePaymentWhere} from '@/server/payments/active-records';
import {FINANCE_ROLES,hasAnyRole,type Role} from '@/lib/roles';
import type {ViewableFile} from '@/lib/viewable-file';
import {reportDocumentFiles,reportDocumentSelect,paymentReportDocumentsSelect} from '@/server/finance-documents/view';
/** Область движений задаёт warehouse reader; без финансовой роли метаданные не выбираем. */
export async function loadMovementReportDocumentSets(actor:{roles:Role[]},movementIds:readonly string[],database:Pick<Prisma.TransactionClient,'stockPurchase'>){
 const documents=new Map<string,ViewableFile[]>();
 if(!hasAnyRole(actor.roles,FINANCE_ROLES)||!movementIds.length)return documents;
 const purchases=await database.stockPurchase.findMany({
  where:{movementId:{in:[...new Set(movementIds)]},movement:{...activeStockMovementWhere,type:'INCOME',receiptKind:'PAID'},payment:activePaymentWhere},
  select:{movementId:true,payment:{select:{reportDocument:{select:reportDocumentSelect},reportDocuments:paymentReportDocumentsSelect}}},
 });
 for(const purchase of purchases){const files=reportDocumentFiles(purchase.payment);if(files.length)documents.set(purchase.movementId,files);}
 return documents;
}

/** Совместимый одиночный reader для прежних внутренних клиентов и frozen reference. */
export async function loadMovementReportDocuments(...args:Parameters<typeof loadMovementReportDocumentSets>){
 const sets=await loadMovementReportDocumentSets(...args);
 return new Map([...sets].map(([id,files])=>[id,files[0]!]));
}
