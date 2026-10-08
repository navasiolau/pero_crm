import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdir,realpath,unlink} from "node:fs/promises";
import path from "node:path";
import {PrismaClient} from "@prisma/client";
import {encode} from "@auth/core/jwt";
import {chromium,expect,type Page} from "@playwright/test";
import sharp from "sharp";
import {createDocumentRowFixture,deleteDocumentRowFixture,documentRowBaseline} from "./helpers/document-row-fixture";
import {receiptPdf} from "./helpers/receipt-pdf";
process.loadEnvFile(".env");
const target=new URL(process.env.DATABASE_URL??"");
assert.ok(["localhost","127.0.0.1"].includes(target.hostname)&&target.port==="5433"&&target.pathname==="/pero_crm","LOCAL_DATABASE_GUARD");
assert.equal(process.env.CRM_FILE_STORAGE,"local","LOCAL_STORAGE_GUARD");
const baseUrl="http://localhost:3097",db=new PrismaClient(),marker="qa-report97-ui-"+randomUUID(),output=path.resolve("../../.playwright-mcp/finance97-review");
async function fullscreen(page:Page){
 const popup=page.getByRole("dialog");
 await expect.poll(async()=>{const box=await popup.boundingBox();const size=page.viewportSize()!;return !!box&&Math.abs(box.x)<2&&Math.abs(box.y)<2&&Math.abs(box.width-size.width)<2&&Math.abs(box.height-size.height)<2;}).toBe(true);
}
async function main(){
 const before=await documentRowBaseline(db),browser=await chromium.launch({headless:true,channel:'chromium'});
 const secret=process.env.AUTH_SECRET;assert.ok(secret);await mkdir(output,{recursive:true});
 try{
  const fixture=await db.$transaction(tx=>createDocumentRowFixture(tx,marker));
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  async function login(){const user=await db.user.findUniqueOrThrow({where:{id:marker},select:{sessionVersion:true}});const cookie=await encode({secret:secret!,salt:"authjs.session-token",maxAge:600,token:{id:marker,sub:marker,sessionVersion:user.sessionVersion}});await context.addCookies([{name:"authjs.session-token",value:cookie,url:baseUrl,httpOnly:true,sameSite:"Lax"}]);}
  await login();const page=await context.newPage(),errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(baseUrl+"/finance/documents",{waitUntil:"networkidle"});
  await expect(page).toHaveURL(baseUrl+"/finance/expenses");
  await page.getByRole("button",{name:"Добавить расход",exact:true}).click();
  const png=await sharp({create:{width:640,height:360,channels:3,background:"#dbeafe"}}).png().toBuffer();
  await page.locator("#pay-document").setInputFiles({name:"QA Report97.png",mimeType:"image/png",buffer:png});
  await page.getByRole("button",{name:"QA Report97.png",exact:true}).waitFor();
  const imageDocument=await db.financeDocument.findFirstOrThrow({where:{uploadedById:marker}});
  await page.getByRole("button",{name:"Отмена",exact:true}).click();
  await db.payment.update({where:{id:fixture.payment.id},data:{reportDocumentId:imageDocument.id}});
  await page.reload({waitUntil:"networkidle"});await page.getByPlaceholder("Поиск по расходам…").fill(marker);
  await expect(page.getByRole("button",{name:"Отчетный документ",exact:true})).toHaveCount(1);
  await page.getByRole("button",{name:"Отчетный документ",exact:true}).click();await fullscreen(page);
  const picture=page.getByRole("img",{name:"QA Report97.png",exact:true});await expect.poll(()=>picture.evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBe(640);
  await page.screenshot({path:path.join(output,"report-image-desktop.png"),animations:"disabled"});
  await page.getByRole("button",{name:"Закрыть полноэкранный просмотр",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const pdf=receiptPdf(),upload=await context.request.post(baseUrl+"/api/finance/documents/upload",{multipart:{clientMutationId:randomUUID(),file:{name:"QA Report97.pdf",mimeType:"application/pdf",buffer:pdf}}});
  assert.equal(upload.status(),201);const uploaded=await upload.json(),documentId=uploaded.document.id;
  await db.payment.update({where:{id:fixture.payment.id},data:{reportDocumentId:documentId}});
  await page.reload({waitUntil:"networkidle"});await page.getByPlaceholder("Поиск по расходам…").fill(marker);
  await page.getByRole("button",{name:"Отчетный документ",exact:true}).click();await fullscreen(page);
  const frame=page.locator('iframe[title="QA Report97.pdf"]');await expect(frame).toHaveAttribute("src","/api/finance/documents/"+documentId+"?view=1");
  await expect(frame).toBeVisible();await page.waitForLoadState('networkidle');assert.equal(context.pages().length,1);
  assert.ok(page.frames().some(frame=>frame.url().startsWith('chrome-extension://')),'NATIVE_PDF_RENDERER_REQUIRED');
  const pdfResponse=await context.request.get(baseUrl+"/api/finance/documents/"+documentId+"?view=1");assert.equal(pdfResponse.status(),200);assert.deepEqual(await pdfResponse.body(),pdf);assert.match(pdfResponse.headers()["content-disposition"],/^inline/);
  await page.screenshot({path:path.join(output,"report-pdf-desktop.png"),animations:"disabled"});
  await page.getByRole("button",{name:"Закрыть",exact:true}).click();await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole("button",{name:"Отчетный документ",exact:true})).toHaveCount(1);
  await page.getByRole("button",{name:"Отчетный документ",exact:true}).click();await fullscreen(page);await page.waitForLoadState('networkidle');
  await page.screenshot({path:path.join(output,"report-pdf-mobile.png"),animations:"disabled"});
  await page.getByRole("button",{name:"Закрыть",exact:true}).click();
  await page.goto(baseUrl+"/warehouse/movements",{waitUntil:"networkidle"});await page.getByPlaceholder("Поиск по движениям…").fill(marker);
  await expect(page.getByRole("button",{name:"Отчетный документ",exact:true})).toHaveCount(1);
  await expect(page.getByRole("article").filter({hasText:"Инвентарный приход"}).getByRole("button",{name:"Отчетный документ",exact:true})).toHaveCount(0);
  await page.screenshot({path:path.join(output,"movement-documents-mobile.png"),fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"Отчетный документ",exact:true}).click();await fullscreen(page);
  await expect(page.locator('iframe[title="QA Report97.pdf"]')).toHaveAttribute("src","/api/finance/documents/"+documentId+"?view=1");
  await page.getByRole("button",{name:"Закрыть",exact:true}).click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"MOBILE_OVERFLOW");
  await db.user.update({where:{id:marker},data:{roles:["MANAGER"]}});await login();
  await page.reload({waitUntil:"networkidle"});await page.getByPlaceholder("Поиск по движениям…").fill(marker);
  await expect(page.getByRole("button",{name:"Отчетный документ",exact:true})).toHaveCount(0);
  assert.ok(!(await page.content()).includes(documentId));
  assert.equal((await context.request.get(baseUrl+"/api/finance/documents/"+documentId,{maxRedirects:0})).status(),403);
  assert.deepEqual(errors,[]);console.log("BROWSER97 REVIEW PASS: real operation upload, redirect, same PDF/image document in expense/stock rows, missing/manager hidden, fullscreen1440/390, no popup/row propagation");
 }finally{
  await browser.close();
  for(const document of await db.financeDocument.findMany({where:{uploadedById:marker}})){
   assert.match(document.storageKey,/^finance-documents\/[0-9a-f-]{36}\/[0-9a-f]{64}$/);
   const uploads=await realpath(path.resolve("uploads")),file=await realpath(path.join(uploads,...document.storageKey.split("/"))),relative=path.relative(uploads,file);
   assert.ok(relative&&!relative.startsWith("..")&&!path.isAbsolute(relative),"FILE_CLEANUP_GUARD");await unlink(file);
  }
  await db.$transaction(tx=>deleteDocumentRowFixture(tx,marker));assert.deepEqual(await documentRowBaseline(db),before);
  await db.$disconnect();console.log("BROWSER97 REVIEW original hashes MATCH; own test rows/bytes removed; notifications0");
 }
}
void main().catch(async error=>{console.error(error);await db.$disconnect();process.exitCode=1;});
