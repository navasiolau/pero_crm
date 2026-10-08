import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { encode } from "@auth/core/jwt";
import { chromium, expect } from "@playwright/test";
import { createTaskTransaction } from "../src/server/tasks/transaction";
import { createExpenseLedgerFixture, deleteExpenseLedgerFixture } from "./helpers/project-expense-fixture";
import { expenseLedgerBaseline } from "./project-expense-native-scenarios";

process.loadEnvFile(".env");
const target=new URL(process.env.DATABASE_URL??"");
assert.ok(["localhost","127.0.0.1"].includes(target.hostname)&&target.port==="5433"&&target.pathname==="/pero_crm","LOCAL_TARGET_GUARD");
const db=new PrismaClient(), marker=`qa101-${randomUUID()}`, baseUrl="http://localhost:3097", output=path.resolve("../../.playwright-mcp/finance101");
async function main() {
  const before=await expenseLedgerBaseline(db), browser=await chromium.launch({headless:true});
  try {
    const fixture=await createTaskTransaction(db)(tx=>createExpenseLedgerFixture(tx,marker));
    const secret=process.env.AUTH_SECRET;assert.ok(secret);
    const token=await encode({secret,salt:"authjs.session-token",maxAge:600,token:{id:marker,sub:marker,sessionVersion:0}});
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    await context.addCookies([{name:"authjs.session-token",value:token,url:baseUrl,httpOnly:true,sameSite:"Lax"}]);
    const page=await context.newPage();await mkdir(output,{recursive:true});
    await page.goto(`${baseUrl}/finance/projects/${fixture.project.id}`,{waitUntil:"networkidle"});
    await expect(page.getByRole("heading",{name:"Расходы",exact:true})).toBeVisible();
    assert.ok(!(await page.locator("body").innerText()).includes("PRIVATE_TECH_QA101"));
    const filter=page.getByLabel("Статья расходов");
    await filter.selectOption("warehouse");
    await expect(page.getByText("По статье:")).toContainText("40");
    await page.getByRole("row").filter({hasText:"Выдача со склада"}).getByRole("button",{name:"Открыть",exact:true}).click();
    const dialog=page.getByRole("dialog");
    await expect(dialog).toContainText("20,000000001 BYN");
    await expect(dialog.getByRole("button",{name:"Удалить расход",exact:true})).toHaveCount(0);
    await dialog.screenshot({path:path.join(output,"stock-detail-desktop.png"),animations:"disabled"});
    await dialog.locator('[data-slot="dialog-footer"]').getByRole("button",{name:"Закрыть",exact:true}).click();
    await page.screenshot({path:path.join(output,"ledger-desktop.png"),fullPage:true,animations:"disabled"});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"MOBILE_OVERFLOW");
    await page.getByRole("article").filter({hasText:"Возврат на склад"}).click();
    await expect(dialog).toContainText("20");
    await dialog.getByRole("button",{name:fixture.issue.id,exact:true}).click();
    await expect(dialog.getByRole("heading",{name:"Выдача со склада",exact:true})).toBeVisible();
    await dialog.screenshot({path:path.join(output,"stock-detail-mobile.png"),animations:"disabled"});
    await dialog.locator('[data-slot="dialog-footer"]').getByRole("button",{name:"Закрыть",exact:true}).click();
    await filter.selectOption(`article:${fixture.article.id}`);
    await expect(page.getByRole("article")).toHaveCount(1);
    await page.getByRole("article").click();
    await expect(dialog.getByRole("button",{name:"Удалить расход",exact:true})).toBeVisible();
    await dialog.locator('[data-slot="dialog-footer"]').getByRole("button",{name:"Закрыть",exact:true}).click();
    const combined=await db.user.update({where:{id:marker},data:{roles:["MANAGER","ACCOUNTANT"]}});
    const combinedToken=await encode({secret,salt:"authjs.session-token",maxAge:600,token:{id:marker,sub:marker,sessionVersion:combined.sessionVersion}});
    await context.addCookies([{name:"authjs.session-token",value:combinedToken,url:baseUrl,httpOnly:true,sameSite:"Lax"}]);
    await page.goto(`${baseUrl}/projects/${fixture.project.id}?tab=finance`,{waitUntil:"networkidle"});
    assert.ok(page.url().includes(`/projects/${fixture.project.id}`));
    await expect(page.getByRole("article").filter({hasText:"Выдача со склада"})).toHaveCount(1);
    console.log("BROWSER101: article filter, precise frozen cost, source return link, desktop/mobile, read-only warehouse PASS");
  } finally {
    await browser.close();
    await createTaskTransaction(db)(tx=>deleteExpenseLedgerFixture(tx,marker));
    assert.deepEqual(await expenseLedgerBaseline(db),before);
    await db.$disconnect();console.log("BROWSER101: original hashes MATCH, own fixtures cleaned, notifications0");
  }
}
void main().catch(async error=>{console.error(error);await db.$disconnect();process.exitCode=1;});
