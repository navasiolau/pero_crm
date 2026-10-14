import assert from "node:assert/strict";
import { test } from "node:test";
import { type Prisma, type Role, type PrismaClient } from "@prisma/client";
import { ordinaryFileListView, type OrdinaryFileForList } from "../src/server/files/list-view";
import { fetchPrintableFile, getPrintableFileKind, getImagePrintPage } from "../src/lib/browser-file-print";
import { type ViewableFile } from "../src/lib/viewable-file";
import { productAttachmentGroups } from "../src/lib/product-attachment-groups";
import { resolveUploadContext } from "../src/server/files/upload-context";
import { fixtureModel, type FixtureRow } from "./helpers/visibility-fixture";

{ // Источник: file-list-view.test.ts
function fixture({status="DESIGN",engineerId="engineer",participant=false,taskOwner="worker"}: {status?: string;engineerId?: string;participant?: boolean;taskOwner?: string}={}) {
  let contextReads=0;
  const db={
    project:{findFirst:async()=>{contextReads++;return{id:"project",number:"QA115",products:[{id:"product"}],tasks:[{id:"task"}]};}},
    product:{findFirst:async()=>({id:"product",number:"QA115.1",engineerId,status})},
    task:{findMany:async()=>participant?[{id:"task",productId:"product",projectId:"project",product:{projectId:"project"},work:{productId:"product",projectId:"project"}}]:[],findFirst:async()=>({productId:"product",assigneeId:taskOwner})},
    file:{delete:async()=>{throw Error("PROJECTION_WRITE_FORBIDDEN")}},
  } as unknown as Prisma.TransactionClient;
  const file:OrdinaryFileForList={id:"file",fileName:"Исходное имя.v2.png",mimeType:"image/png",section:"MEASUREMENT",uploadedById:"engineer",projectId:"project",productId:"product",taskId:null};
  return{db,file,get contextReads(){return contextReads;}};
}
const actor=(id:string,roles:Role[])=>({id,roles});

test("ordinary projection strips audit/context metadata and preserves the exact filename section and immutable source",async()=>{
 const f=fixture(),original={...f.file,size:200,storedName:"private-key",createdAt:new Date(0)},before=structuredClone(original);
 const [view]=await ordinaryFileListView(f.db,actor("manager",["MANAGER"]),[original]);
 assert.deepEqual(Object.keys(view).sort(),["id","fileName","mimeType","section","canDelete"].sort());
 assert.equal(view.fileName,original.fileName);assert.equal(view.section,"MEASUREMENT");assert.equal(view.canDelete,true);assert.deepEqual(original,before);assert.equal(f.contextReads,0);
});

test("own assigned engineer can delete in DESIGN while a foreign uploader remains unavailable",async()=>{
 const f=fixture();const views=await ordinaryFileListView(f.db,actor("engineer",["ENGINEER"]),[f.file,{...f.file,id:"foreign",uploadedById:"someone"}]);
 assert.deepEqual(views.map(view=>view.canDelete),[true,false]);
});

test("live stale status and current participant assignment follow the existing exact permission policy",async()=>{
 const stale=fixture({status:"PRODUCTION"});assert.equal((await ordinaryFileListView(stale.db,actor("engineer",["ENGINEER"]),[stale.file]))[0].canDelete,false);
 const member=fixture({engineerId:"someone",participant:true});assert.equal((await ordinaryFileListView(member.db,actor("engineer",["ENGINEER"]),[member.file]))[0].canDelete,true);
});

test("field user deletes only own file in its own task context",async()=>{
 const f=fixture(),file={...f.file,uploadedById:"worker",taskId:"task"};assert.equal((await ordinaryFileListView(f.db,actor("worker",["WORKER"]),[file]))[0].canDelete,true);
 const other=fixture({taskOwner:"someone"});assert.equal((await ordinaryFileListView(other.db,actor("worker",["WORKER"]),[file]))[0].canDelete,false);
});

test("readonly financial roles and missing actor never gain ordinary deletion rights",async()=>{
 const f=fixture();for(const roles of [["ACCOUNTANT"],["PROCUREMENT"],[]] as Role[][])assert.equal((await ordinaryFileListView(f.db,actor("engineer",roles),[f.file]))[0].canDelete,false);
 assert.equal((await ordinaryFileListView(f.db,undefined,[f.file]))[0].canDelete,false);
});
}

// Источник: browser-file-print.test.ts
const file: ViewableFile = { id: 'file-116', fileName: 'Эскиз.png', mimeType: 'image/png' };
const pdf: ViewableFile = { ...file, fileName: 'Документ.pdf', mimeType: 'application/pdf' };
const pdfBytes = '%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstartxref\n9\n%%EOF\n';
const okFetch: typeof fetch = async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });

for (const mimeType of ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/svg+xml', 'image/apng', 'image/x-icon']) {
 test(`кнопка допускается для browser image ${mimeType}`, () => assert.equal(getPrintableFileKind({ mimeType }), 'image'));
}
for (const mimeType of ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream', 'image/tiff', 'image/heic', 'video/mp4', 'text/html', 'image/unknown']) {
 test(`неподдерживаемый ${mimeType} не имеет печати`, () => assert.equal(getPrintableFileKind({ mimeType }), null));
}
test('PDF определяется MIME, параметры/регистр допускаются', () => {
 assert.equal(getPrintableFileKind({ mimeType: 'Application/PDF; charset=binary' }), 'pdf');
 assert.equal(getPrintableFileKind({ mimeType: '' }), null);
});
test('проектный оригинал и финансовый PDF используют только защищённые routes', async () => {
 const calls: Array<{ url: string; init?: RequestInit }> = [];
 const fetcher: typeof fetch = async (url, init) => {
  calls.push({ url: String(url), init });
  return String(url).includes('finance') ? new Response(pdfBytes, { headers: { 'Content-Type': 'application/pdf' } }) : okFetch(url, init);
 };
 assert.deepEqual(new Uint8Array(await (await fetchPrintableFile(file, { fetcher })).arrayBuffer()), new Uint8Array([137,80,78,71]));
 assert.equal(await (await fetchPrintableFile({ ...pdf, source: 'finance' }, { fetcher })).text(), pdfBytes);
 assert.deepEqual(calls.map(call => call.url), ['/api/files/file-116', '/api/finance/documents/file-116?view=1']);
 for (const { init } of calls) {
  assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.cache, 'no-store'); assert.equal(init?.redirect, 'error');
 }
});
for (const status of [401,403,404,500]) {
 test(`ответ ${status} не передаётся печати`, async () => {
  await assert.rejects(fetchPrintableFile(file, { fetcher: async () => new Response('denied', { status }) }), /доступ|загрузить/i);
 });
}
test('страница входа, несоответствующий MIME, пустые байты и поддельный PDF отклоняются', async () => {
 for (const response of [new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }), new Response('PDF', { headers: { 'Content-Type': 'application/pdf' } }), new Response('', { headers: { 'Content-Type': 'image/png' } })]) {
  await assert.rejects(fetchPrintableFile(file, { fetcher: async () => response }), /формат|пуст/i);
 }
 for (const body of ['<html>login</html>', '%PDF-1.7\nbroken']) {
  await assert.rejects(fetchPrintableFile(pdf, { fetcher: async () => new Response(body, { headers: { 'Content-Type': 'application/pdf' } }) }), /PDF/i);
 }
});
test('произвольные URL и пути не допускаются через id', async () => {
 let calls = 0;
 for (const id of ['', '../../login', 'https://external.invalid/a', 'id?view=1', 'id#fragment', 'id/other']) {
  await assert.rejects(fetchPrintableFile({ ...file, id }, { fetcher: async () => { calls++; return okFetch(''); } }), /файл/i);
 }
 assert.equal(calls, 0);
});
test('отмена перед fetch не читает файл', async () => {
 const controller = new AbortController(); controller.abort(); let calls = 0;
 await assert.rejects(fetchPrintableFile(file, { signal: controller.signal, fetcher: async () => { calls++; return okFetch(''); } }), { name: 'AbortError' });
 assert.equal(calls,0);
});
test('изображение вписывается целиком на страницу с ориентацией по пропорциям', () => {
 assert.deepEqual(getImagePrintPage(400,1600), { orientation:'portrait', widthMm:210, heightMm:297 });
 assert.deepEqual(getImagePrintPage(1600,400), { orientation:'landscape', widthMm:297, heightMm:210 });
 assert.equal(getImagePrintPage(600,600).orientation,'portrait');
});

// Источник: product-attachment-groups.test.ts
test('sections preserve original objects and order and keep product general/task files visible',()=>{
 const files=Object.freeze([
  Object.freeze({id:'assembly-migrated',section:'PRODUCTION',storedName:'unchanged-assembly'}),
  Object.freeze({id:'task-general',section:'GENERAL',taskId:'task',storedName:'unchanged-task'}),
  Object.freeze({id:'sketch',section:'PRODUCTION'}),
  Object.freeze({id:'install',section:'INSTALLATION'}),
  Object.freeze({id:'measure',section:'MEASUREMENT'}),
 ]);
 const groups=productAttachmentGroups(files,'sketch');
 assert.deepEqual(groups.production,[files[0],files[1]]);assert.deepEqual(groups.installation,[files[3]]);assert.deepEqual(groups.measurement,[files[4]]);
 const visible=[...groups.measurement,...groups.production,...groups.installation];assert.equal(visible.length,4);assert.equal(new Set(visible.map(file=>file.id)).size,4);groups.production.forEach((file,i)=>assert.strictEqual(file,files[i]));
});
test('current sketch originally selected from measurement never appears twice',()=>{
 const cover=Object.freeze({id:'measurement-sketch',section:'MEASUREMENT',storedName:'same-key'}),ordinary=Object.freeze({id:'ordinary',section:'PRODUCTION'});
 const groups=productAttachmentGroups([cover,ordinary],cover.id);assert.deepEqual(groups.measurement,[]);assert.deepEqual(groups.production,[ordinary]);assert.deepEqual(groups.installation,[]);
});
test('previous sketch becomes its ordinary section attachment after replacement',()=>{
 const old=Object.freeze({id:'old-sketch',section:'PRODUCTION',storedName:'unchanged-key'}),current=Object.freeze({id:'new-sketch',section:'PRODUCTION'});
 const groups=productAttachmentGroups([old,current],current.id);assert.deepEqual(groups.production,[old]);assert.strictEqual(groups.production[0],old);
});

{ // Источник: product-attachments-upload-acl.test.ts
function fixture(assigneeId:string){const project:FixtureRow={id:'j',number:'1',products:[],tasks:[]};const product:FixtureRow={id:'p',number:'1.1',projectId:'j',project,engineerId:'e',status:'DESIGN',tasks:[]};const task:FixtureRow={id:'t',projectId:'j',project,productId:'p',product,assigneeId,status:'NEW',work:null};project.products=[product];project.tasks=[task];product.tasks=[task];return{project,product,task,db:{project:fixtureModel([project]),product:fixtureModel([product]),task:fixtureModel([task]),productPercentageParticipant:fixtureModel([])} as unknown as PrismaClient};}
const context={projectId:'j',productId:'p',taskId:null};
test('read-only accountant without an execution assignment has no upload capability',async()=>{const f=fixture('worker');assert.equal(await resolveUploadContext(f.db,{id:'accountant',roles:['ACCOUNTANT']},context),null)});
test('actual assigned field roles retain upload access on their visible status and manager union retains full grant',async()=>{for(const roles of [['WORKER'],['MOUNTER'],['ENGINEER','WORKER'],['MANAGER','ENGINEER']] as Role[][]){const f=fixture('worker');f.product.status=roles.length===1&&roles.includes('MOUNTER')?'INSTALLATION':'PRODUCTION';assert.ok(await resolveUploadContext(f.db,{id:'worker',roles},context));}});
test('pure engineer only uploads own DESIGN product and task/product mismatch is rejected',async()=>{const f=fixture('worker');assert.ok(await resolveUploadContext(f.db,{id:'e',roles:['ENGINEER']},context));f.product.status='PRODUCTION';assert.equal(await resolveUploadContext(f.db,{id:'e',roles:['ENGINEER']},context),null);assert.equal(await resolveUploadContext(f.db,{id:'m',roles:['MANAGER']},{...context,productId:'foreign',taskId:'t'}),null)});

test('historical accountant assignment cannot grant upload; independent field union still can',async()=>{const f=fixture('accountant');assert.equal(await resolveUploadContext(f.db,{id:'accountant',roles:['ACCOUNTANT']},context),null);f.product.status='PRODUCTION';assert.ok(await resolveUploadContext(f.db,{id:'accountant',roles:['ACCOUNTANT','WORKER']},context));});
}
