import {Prisma} from '@prisma/client';
import type {JournalEntryInput} from './contract';
import {collectJournalReferences,referenceKey,type JournalReference,type JournalReferenceMap} from './reference-context';

export type JournalReferenceDb=Pick<Prisma.TransactionClient,'$queryRaw'>;
type ReferenceRow={id:string;alias?:string;label:string;number?:string;projectId?:string|null;productId?:string|null;taskId?:string|null;createdAt?:Date};
type ReferenceSource={select:string;from:string;id?:string;href?:(row:ReferenceRow)=>string;ownership?:'fixed'|'mutable'};
const entityHref=(base:string)=>(row:ReferenceRow)=>`${base}/${encodeURIComponent(row.id)}`;
// Имена таблиц и SQL-выражения — только этот закрытый реестр; входные ID передаются параметрами.
const SOURCES:Record<string,ReferenceSource>={
 project:{select:`r.id, r.number, 'Проект ' || r.number AS label, r."createdAt"`,from:'"Project" r',href:entityHref('/projects')},
 projectNumber:{select:`r.id, r.number AS alias, r.number, 'Проект ' || r.number AS label, r."createdAt"`,from:'"Project" r',id:'r.number',href:entityHref('/projects')},
 product:{select:`r.id, r.number, 'Изделие ' || r.number AS label, r."projectId", r."createdAt"`,from:'"Product" r',href:entityHref('/products')},
 task:{select:`r.id, 'Задача ' || r.title AS label, r."projectId", r."productId", r."createdAt"`,from:'"Task" r',ownership:'mutable'},
 work:{select:`r.id, 'Работа ' || r.title AS label, r."projectId", r."productId", r."createdAt"`,from:'"Work" r',ownership:'fixed'},
 file:{select:`r.id, 'Файл ' || r."fileName" AS label, r."projectId", r."productId", r."taskId", r."createdAt"`,from:'"File" r',ownership:'fixed'},
 user:{select:'r.id, r.name AS label',from:'"User" r'},
 client:{select:`r.id, concat_ws(' ',r."lastName",r.name,r."middleName") AS label`,from:'"Client" r'},
 counterparty:{select:'r.id, r.name AS label',from:'"Counterparty" r'},
 material:{select:'r.id, r.name AS label',from:'"Material" r'},
 materialCategory:{select:'r.id, r.name AS label',from:'"MaterialCategory" r'},
 materialUnit:{select:'r.id, r.name AS label',from:'"MaterialUnit" r'},
 priceItem:{select:'r.id, r.name AS label',from:'"PriceItem" r'},
 cashAccount:{select:'r.id, r.name AS label',from:'"CashAccount" r'},
 expenseArticle:{select:'r.id, r.name AS label',from:'"ExpenseArticle" r'},
 plugin:{select:'r.id, r.name AS label',from:'"Plugin" r'},
 apiToken:{select:'r.id, r.name AS label',from:'"ApiToken" r'},
 financeDocument:{select:`r.id, 'Финансовый документ ' || r."fileName" AS label`,from:'"FinanceDocument" r'},
 projectMaterial:{select:`r.id, 'Материал изделия: ' || m.name AS label, r."productId", r."createdAt"`,from:'"ProjectMaterial" r JOIN "Material" m ON m.id=r."materialId"',ownership:'fixed'},
 stockMovement:{select:`r.id, 'Движение материала: ' || m.name AS label, r."productId", r."createdAt"`,from:'"StockMovement" r JOIN "Material" m ON m.id=r."materialId"',ownership:'fixed'},
 payrollEntry:{select:`r.id, 'Начисление: ' || u.name || ', ' || r.month AS label, r."projectId", r."productId", r."taskId", r."createdAt"`,from:'"PayrollEntry" r JOIN "User" u ON u.id=r."userId"',ownership:'fixed'},
 payout:{select:`r.id, 'Выплата: ' || u.name || ', ' || r.month AS label, r."createdAt"`,from:'"Payout" r JOIN "User" u ON u.id=r."userId"'},
 payment:{select:`r.id, 'Платёж ' || r.amount::text || ' ' || r.currency AS label, r."projectId", NULL::text AS "productId", r."createdAt"`,from:'"Payment" r',ownership:'fixed'},
 commercialProposal:{select:`r.id, 'КП ' || COALESCE(p.number,r."sourceNumber",'без номера') AS label, r."projectId", GREATEST(r."createdAt",p."createdAt") AS "createdAt"`,from:'"CommercialProposal" r LEFT JOIN "Project" p ON p.id=r."projectId"',ownership:'fixed'},
 proposalMedia:{select:`r.id, 'Изображение КП: ' || r."fileName" AS label, cp."projectId", r."createdAt"`,from:'"ProposalMedia" r JOIN "CommercialProposal" cp ON cp.id=r."proposalId"',ownership:'fixed'},
 proposalArtifact:{select:`r.id, 'Документ КП: ' || r."fileName" AS label, cp."projectId", r."createdAt"`,from:'"ProposalArtifact" r LEFT JOIN "CommercialProposal" cp ON cp.id=r."proposalId"',ownership:'fixed'},
 logisticsTrip:{select:`r.id, 'Рейс от ' || to_char(r.date,'DD.MM.YYYY') AS label, r."createdAt"`,from:'"LogisticsTrip" r'},
 logisticsDocument:{select:`r.id, 'ТТН: ' || r."fileName" AS label, r."createdAt"`,from:'"LogisticsDocument" r'},
};

async function loadType(db:JournalReferenceDb,type:string,ids:string[]):Promise<JournalReference[]>{
 if(type==='proposalContract'){
  const rows=await db.$queryRaw<ReferenceRow[]>(Prisma.sql`SELECT r.id,r."primaryProposalId" AS alias,'Договор к КП ' || COALESCE(p.number,cp."sourceNumber",'без номера') AS label,
   cp."projectId",GREATEST(r."createdAt",p."createdAt") AS "createdAt" FROM "ProposalContract" r
   JOIN "CommercialProposal" cp ON cp.id=r."primaryProposalId" LEFT JOIN "Project" p ON p.id=cp."projectId"
   WHERE r.id IN (${Prisma.join(ids)}) OR r."primaryProposalId" IN (${Prisma.join(ids)})`);
  return rows.flatMap(row=>[{...row,type,ownership:'fixed' as const},...(row.alias?[{...row,id:row.alias,type,ownership:'fixed' as const}]:[])]);
 }
 if(!Object.hasOwn(SOURCES,type))return [];
 const source=SOURCES[type];
 const rows=await db.$queryRaw<ReferenceRow[]>(Prisma.sql`SELECT ${Prisma.raw(source.select)} FROM ${Prisma.raw(source.from)} WHERE ${Prisma.raw(source.id??'r.id')} IN (${Prisma.join(ids)})`);
 return rows.map(row=>({...row,type,...(source.href?{href:source.href(row)}:{}),
  // SET NULL при старом удалении изделия не доказывает, что файл/работа всегда принадлежали проекту.
  ...(source.ownership?{ownership:(type==='file'||type==='work')&&!row.productId?'mutable' as const:source.ownership}:{})}));
}

export async function loadJournalReferences(db:JournalReferenceDb,entries:JournalEntryInput[]):Promise<JournalReferenceMap>{
 const needed=collectJournalReferences(entries),result:JournalReferenceMap=new Map();
 async function load(type:string,ids:Iterable<string>){
  const values=[...ids].filter(id=>!result.has(referenceKey(type,id)));
  for(let offset=0;offset<values.length;offset+=400){
   for(const row of await loadType(db,type,values.slice(offset,offset+400))){
    result.set(referenceKey(type,type==='projectNumber'&&row.number?row.number:row.id),row);
    if(type==='projectNumber')result.set(referenceKey('project',row.id),{...row,type:'project'});
   }
  }
 }
 for(const [type,ids]of needed)await load(type,ids);
 const products=new Set<string>(),projects=new Set<string>();
 for(const row of result.values()){if(row.productId)products.add(row.productId);if(row.projectId)projects.add(row.projectId);}
 await load('product',products);
 for(const row of result.values())if(row.type==='product'&&row.projectId)projects.add(row.projectId);
 await load('project',projects);
 return result;
}
