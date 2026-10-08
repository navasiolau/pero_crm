import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { encode } from "@auth/core/jwt";
import { chromium, expect } from "@playwright/test";
import { stockPurchaseBaseline } from "./paid-stock-native-scenarios";
import { receiptPdf } from "./helpers/receipt-pdf";
process.loadEnvFile(".env");
const target=new URL(process.env.DATABASE_URL??"");
assert.ok(["localhost","127.0.0.1"].includes(target.hostname)&&target.port==="5433"&&target.pathname==="/pero_crm");
assert.equal(process.env.CRM_FILE_STORAGE,'local');
const db=new PrismaClient(),marker=`qa103-ui-${randomUUID()}`,baseUrl="http://localhost:3098",out=path.resolve("../../.playwright-mcp/finance103-review");
async function main(){
 const before=await stockPurchaseBaseline(db),browser=await chromium.launch({headless:true,channel:'chromium'});
 let cashId="",articleId="",materialId="";
 try{
  await db.$transaction(async tx=>{
   await tx.user.create({data:{id:marker,name:marker,email:marker+"@invalid.local",passwordHash:"qa-login-disabled",roles:["ACCOUNTANT"]}});
   cashId=(await tx.cashAccount.create({data:{name:marker,currency:"BYN"}})).id;
   const max=await tx.expenseArticle.aggregate({_max:{code:true}});
   articleId=(await tx.expenseArticle.create({data:{name:marker,code:(max._max.code??0)+1}})).id;
   materialId=(await tx.material.create({data:{name:marker,unit:"шт",purchasePrice:20}})).id;
  });
  const secret=process.env.AUTH_SECRET;assert.ok(secret);
  const token=await encode({secret,salt:"authjs.session-token",maxAge:600,token:{id:marker,sub:marker,sessionVersion:0}});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addCookies([{name:"authjs.session-token",value:token,url:baseUrl,httpOnly:true,sameSite:"Lax"}]);
  const page=await context.newPage();await mkdir(out,{recursive:true});
  await page.goto(baseUrl+"/finance/expenses",{waitUntil:"networkidle"});
  await page.getByRole("button",{name:"Приход на склад",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Приход на склад",exact:true});
  await expect(dialog.getByText('Отчетный документ (необязательно)',{exact:true})).toBeVisible();
  await dialog.locator('[data-slot="select-trigger"]').nth(1).click();
  await page.getByRole("option",{name:marker,exact:true}).click();
  await dialog.locator("#pay-article").click();await page.getByRole("option",{name:marker,exact:true}).click();
  await dialog.locator("#purchase-material").click();
  await page.getByPlaceholder("Поиск материала…").fill(marker);await page.getByText(marker,{exact:true}).last().click();
  await dialog.locator("#purchase-qty").fill("3");await dialog.locator("#purchase-price").fill("20");
  await expect(dialog.locator("#pay-amount")).toHaveValue("60.00");
  await expect(dialog.getByRole("button",{name:"Оплатить и принять на склад",exact:true})).toBeEnabled();
  await dialog.locator('#pay-document').setInputFiles({name:'Receipt103.pdf',mimeType:'application/pdf',buffer:receiptPdf()});
  await dialog.getByRole('button',{name:'Receipt103.pdf',exact:true}).waitFor();
  const reportDocument=await db.financeDocument.findFirstOrThrow({where:{uploadedById:marker,state:'READY'}});
  await dialog.screenshot({path:path.join(out,"paid-receipt-desktop.png"),animations:"disabled"});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"MOBILE_OVERFLOW");
  await dialog.screenshot({path:path.join(out,"paid-receipt-mobile.png"),animations:"disabled"});
  const submit=dialog.getByRole("button",{name:"Оплатить и принять на склад",exact:true});await submit.scrollIntoViewIfNeeded();
  const box=await submit.boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=844);
  await dialog.screenshot({path:path.join(out,"paid-receipt-mobile-footer.png"),animations:"disabled"});
  await dialog.getByRole("button",{name:"Отмена",exact:true}).click();
  // Display fixture only; actual transaction, caps and rollback are tested natively.
  await db.$transaction(async tx=>{
   const movement=await tx.stockMovement.create({data:{materialId,type:"INCOME",receiptKind:"PAID",quantity:3,unitPrice:20,totalByn:60,comment:marker,createdById:marker}});
   const payment=await tx.payment.create({data:{direction:"EXPENSE",amount:60,bynAmount:60,currency:"BYN",rate:1,cashAccountId:cashId,expenseArticleId:articleId,comment:marker,createdById:marker,reportDocumentId:reportDocument.id}});
   await tx.stockPurchase.create({data:{clientMutationId:randomUUID(),requestFingerprint:marker,actorId:marker,unitPrice:20,movementId:movement.id,paymentId:payment.id}});
  });
  await page.reload({waitUntil:"networkidle"});await page.getByPlaceholder("Поиск по расходам…").fill(marker);
  await page.getByRole("article").filter({hasText:"Приход на склад"}).click();
  const detail=page.getByRole("dialog",{name:"Расход",exact:true});
  await expect(detail.getByRole("heading",{name:"Расход",exact:true})).toBeInViewport();
  await expect(detail).toContainText("Стоимость запаса");await expect(detail).toContainText("60 BYN");
  await expect(detail.getByRole("button",{name:"Удалить",exact:true})).toBeDisabled();
  await detail.screenshot({path:path.join(out,"paid-receipt-detail-mobile.png"),animations:"disabled"});
  await detail.getByRole('button',{name:'Отчетный документ',exact:true}).click();
  await expect(page.locator('iframe[title="Receipt103.pdf"]')).toHaveAttribute('src','/api/finance/documents/'+reportDocument.id+'?view=1');
  await expect.poll(()=>page.frames().some(frame=>frame.url().startsWith('chrome-extension://'))).toBe(true);
  await page.waitForLoadState('networkidle');await page.screenshot({path:path.join(out,'paid-document-mobile.png'),animations:'disabled'});
  console.log("BROWSER103 PASS: shared paid form, material/cash/article, invoice60, no required file, 1440/390/footer, linked purchase detail and disabled deletion; no monetary submit");
 }finally{
  await browser.close();
  for(const document of await db.financeDocument.findMany({where:{uploadedById:marker}})){
   assert.match(document.storageKey,/^finance-documents\/[0-9a-f-]{36}\/[0-9a-f]{64}$/);
   const root=await realpath(path.resolve('uploads')),file=await realpath(path.join(root,...document.storageKey.split('/'))),relative=path.relative(root,file);
   assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));await unlink(file);
  }
  await db.$transaction(async tx=>{
   await tx.stockPurchase.deleteMany({where:{actorId:marker}});
   await tx.stockMovement.deleteMany({where:{createdById:marker,comment:marker}});
   await tx.payment.deleteMany({where:{createdById:marker,comment:marker}});
   await tx.changeLog.deleteMany({where:{actorId:marker,entity:'financeDocument'}});
   await tx.financeDocument.deleteMany({where:{uploadedById:marker}});
   if(materialId)await tx.material.deleteMany({where:{id:materialId,name:marker}});
   if(cashId)await tx.cashAccount.deleteMany({where:{id:cashId,name:marker}});
   if(articleId)await tx.expenseArticle.deleteMany({where:{id:articleId,name:marker}});
   await tx.user.deleteMany({where:{id:marker,name:marker}});
  });
  assert.deepEqual(await stockPurchaseBaseline(db),before,"BROWSER_ORIGINAL_DATA_CHANGED");
  await db.$disconnect();console.log("BROWSER103 original hashes MATCH; own fixtures cleaned; notifications0");
 }
}
void main().catch(async error=>{console.error(error);await db.$disconnect();process.exitCode=1;});
