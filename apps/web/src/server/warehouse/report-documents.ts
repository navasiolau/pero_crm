import type {Prisma} from '@prisma/client';
import {activeStockMovementWhere} from './active-records';
import {activePaymentWhere} from '@/server/payments/active-records';
import {FINANCE_ROLES,hasAnyRole,type Role} from '@/lib/roles';
import type {ViewableFile} from '@/lib/viewable-file';
import {reportDocumentFile,reportDocumentSelect} from '@/server/finance-documents/view';
/** Область движений задаёт warehouse reader; без финансовой роли метаданные не выбираем. */
export async function loadMovementReportDocuments(actor:{roles:Role[]},movementIds:readonly string[],database:Pick<Prisma.TransactionClient,'stockPurchase'>){
 const documents=new Map<string,ViewableFile>();
 if(!hasAnyRole(actor.roles,FINANCE_ROLES)||!movementIds.length)return documents;
 const purchases=await database.stockPurchase.findMany({
  where:{movementId:{in:[...new Set(movementIds)]},movement:{...activeStockMovementWhere,type:'INCOME',receiptKind:'PAID'},payment:activePaymentWhere},
  select:{movementId:true,payment:{select:{reportDocument:{select:reportDocumentSelect}}}},
 });
 for(const purchase of purchases){const document=reportDocumentFile(purchase.payment.reportDocument);if(document)documents.set(purchase.movementId,document);}
 return documents;
}
