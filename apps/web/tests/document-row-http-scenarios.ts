import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import type {FinanceDocument,PrismaClient} from '@prisma/client';
import {createDocumentRowFixture,deleteDocumentRowFixture,documentRowBaseline} from './helpers/document-row-fixture';import {receiptPdf} from './helpers/receipt-pdf';
export async function runDocumentRowHttp(db:PrismaClient,request:(path:string,id:string,options?:RequestInit)=>Promise<Response>,removeOwnObject:(document:FinanceDocument,bytes:Buffer)=>Promise<void>){
 const before=await documentRowBaseline(db),marker='qa-row97-http-'+randomUUID(),bytes=receiptPdf();
 try{
  const fixture=await db.$transaction(tx=>createDocumentRowFixture(tx,marker)),mutation=randomUUID();
  const form=()=>{const value=new FormData();value.set('clientMutationId',mutation);value.set('file',new File([new Uint8Array(bytes)],marker+'.pdf',{type:'application/pdf'}));return value;};
  const uploaded=await request('/api/finance/documents/upload',marker,{method:'POST',body:form()});assert.equal(uploaded.status,201);
  const result=await uploaded.json(),id=result.document.id;assert.ok(id);
  const repeated=await request('/api/finance/documents/upload',marker,{method:'POST',body:form()});assert.equal(repeated.status,200);assert.equal((await repeated.json()).document.id,id);
  await db.payment.update({where:{id:fixture.payment.id},data:{reportDocumentId:id}});
  const oldPage=await request('/finance/documents',marker);assert.ok([302,303,307,308].includes(oldPage.status));assert.equal(new URL(oldPage.headers.get('location')!,'http://localhost').pathname,'/finance/expenses');
  const finance=await request('/finance',marker);assert.equal(finance.status,200);assert.ok(!(await finance.text()).includes('href="/finance/documents"'));
  for(const path of ['/finance/expenses','/warehouse/movements']){
   const page=await request(path,marker);assert.equal(page.status,200);const html=await page.text();assert.ok(html.includes(id));assert.ok(html.includes('Отчетный документ'));assert.ok(html.includes(marker+'.pdf'));
  }
  const original=await request('/api/finance/documents/'+id+'?view=1',marker);assert.equal(original.status,200);assert.match(original.headers.get('content-disposition')!,/^inline/);assert.equal(original.headers.get('content-security-policy'),'sandbox');assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);
  await db.user.update({where:{id:marker},data:{roles:['MANAGER']}});
  const hidden=await request('/warehouse/movements',marker);assert.equal(hidden.status,200);const html=await hidden.text();assert.ok(!html.includes(id));assert.ok(!html.includes(marker+'.pdf'));
  assert.equal((await request('/api/finance/documents/'+id+'?view=1',marker)).status,403);
  return {status:'PASS',sameDocument:'EXPENSE_AND_STOCK',oldPage:'REDIRECT',tile:'REMOVED',realPdf:'INLINE_BYTES_MATCH',manager:'METADATA_AND_BYTES_DENIED',providerMessages:0};
 }finally{
  for(const document of await db.financeDocument.findMany({where:{uploadedById:marker}}))await removeOwnObject(document,bytes);
  await db.$transaction(tx=>deleteDocumentRowFixture(tx,marker));assert.deepEqual(await documentRowBaseline(db),before,'HTTP_ORIGINAL_DATA_CHANGED');
 }
}
