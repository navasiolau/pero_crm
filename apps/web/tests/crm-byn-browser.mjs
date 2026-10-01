// Read-only acceptance of the deployed compiled app. Cookies supplied privately by caller.
import assert from "node:assert/strict";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const sizes = [[320,800],[360,800],[390,844],[768,1024],[1024,768],[1440,900]];
export async function runCrmBynBrowser({ origin, profiles, basicAuth, outputDir, onOwnWrites, readActionIds = [] }) {
  assert.equal(new URL(origin).origin, origin, "ORIGIN_ONLY_REQUIRED");
  assert.ok(profiles?.admin && outputDir, "ADMIN_PROFILE_AND_OUTPUT_DIRECTORY_REQUIRED");
  await mkdir(outputDir,{recursive:true});
  const browser=await chromium.launch({headless:true});
  const receipt={kind:"crm-byn-compiled-browser",origin,checks:[],screenshots:[],skips:[],failures:[],mutationsBlocked:[],ownWrites:[],zoomMode:"200% CSS zoom; not browser zoom",authentication:"caller supplied short-lived session; password login not tested"};
  const own = new Map();
  let bellActionId;
  let activePage;
  let activeProfile;
  const pending = new Set();
  async function persistOwned() {
    receipt.ownWrites=[...own.values()];
    const path=resolve(outputDir,"crm-byn-own-writes.json");
    await writeFile(`${path}.tmp`,JSON.stringify(receipt.ownWrites),{mode:0o600});
    await rename(`${path}.tmp`,path);
    if(onOwnWrites)await onOwnWrites(receipt.ownWrites);
  }
  try {
    for(const [name,profile] of Object.entries(profiles)) {
      if(!profile) {receipt.skips.push(`${name}: profile unavailable`);continue;}
      assert.match(name,/^[a-zA-Z0-9_-]+$/,"SAFE_PROFILE_LABEL_REQUIRED");
      const context=await browser.newContext({httpCredentials:basicAuth,viewport:{width:1440,height:900}});
      const cookies=Array.isArray(profile)?profile:profile.cookies;
      assert.ok(Array.isArray(cookies)&&cookies.length,"SESSION_COOKIES_REQUIRED");
      await context.addCookies(cookies);
      await context.route("**/*",async route=>{
        const request=route.request();
        const url=new URL(request.url());
        if(["GET","HEAD","OPTIONS"].includes(request.method())){await route.continue();return;}
        const action=request.headers()["next-action"];
        let args;try{args=JSON.parse(request.postData()??"");}catch{}
        const sameOrigin=url.origin===origin;
        const appPath=["/projects","/settings/payroll","/payroll","/finance/payroll"].includes(url.pathname)||/^\/projects\/[^/]+$/.test(url.pathname);
        const list=Array.isArray(args)&&args.length===3&&args[0]==="projects"&&typeof args[1]==="string"&&(args[2]===null||typeof args[2]==="string");
        const tab=Array.isArray(args)&&args.length===2&&args[0]==="project.tab"&&["overview","finance"].includes(args[1]);
        const empty=Array.isArray(args)&&args.length===0;
        // Source-verified NotificationsBell mount/poll is the sole zero-arg action
        // issued by this probe. Pin its first action ID, as first-wave QA does.
        if(sameOrigin&&appPath&&action&&empty)bellActionId??=action;
        const read=empty&&action&&(action===bellActionId||readActionIds.includes(action));
        if(sameOrigin&&appPath&&request.method()==="POST"&&action&&(list||tab||read)) {
          const task=(async()=>{
            // Forward once; never continue/retry after upstream may have committed.
            const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:30000});
            const body=await response.body();
            if(list||tab){
              assert.ok(profile.id,"PREFERENCE_ACTOR_ID_REQUIRED");
              const outcomes=[];
              for(const line of body.toString("utf8").split("\n"))try{const value=JSON.parse(line.slice(line.indexOf(":")+1));if(typeof value?.ok==="boolean")outcomes.push(value);}catch{}
              assert.equal(response.status(),200,"PREFERENCE_RESPONSE_HTTP_FAILED");
              assert.equal(outcomes.length,1,"PREFERENCE_RESPONSE_NOT_CAPTURED");
              const outcome=outcomes[0];
              if(outcome.ok){
                const key=list?"projects.list":"project.tab";
                let value=tab?args[1]:outcome.value;
                if(list){const parsed=JSON.parse(value);assert.equal(parsed.version,1);assert.match(parsed.revision,/^[0-9a-f-]{36}$/i);}
                own.set(`${profile.id}/${key}`,{userId:profile.id,key,value});
                await persistOwned();
                if(list)assert.equal(JSON.parse(value).query,args[1],"PREFERENCE_QUERY_MISMATCH");
              }
            }
            await route.fulfill({response,body});
          })();pending.add(task);try{await task;}catch{receipt.failures.push("ACTION_CAPTURE_FAILED_STOP");await route.abort("blockedbyclient").catch(()=>{});}finally{pending.delete(task);}
          return;
        }
        receipt.mutationsBlocked.push({profile:name,method:request.method(),path:url.pathname});
        await route.abort("blockedbyclient");
      });
      const page=await context.newPage();
      activePage=page;activeProfile=name;
      const errors=[];
      page.on("pageerror",()=>errors.push("uncaught browser error"));
      page.on("response",response=>{
        if(response.status()>=400)errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
      });
      const roles=profile.roles??(name==="admin"?["ADMIN"]:name==="manager"?["MANAGER"]:name==="engineer"?["ENGINEER"]:[]);
      const manage=profile.canManage??roles.some(role=>["ADMIN","DIRECTOR","MANAGER"].includes(role));
      const finance=profile.canFinance??roles.some(role=>["ADMIN","DIRECTOR","ACCOUNTANT"].includes(role));
      const projectPath=profile.projectPath??(profile.projectId?`/projects/${encodeURIComponent(profile.projectId)}`:null);
      async function goto(path) {
        const response=await page.goto(`${origin}${path}`,{waitUntil:"networkidle"});
        assert.ok(response&&response.status()<400,"PAGE_REQUEST_FAILED");
        assert.ok(!new URL(page.url()).pathname.startsWith("/login"),"SESSION_NOT_ACCEPTED");
      }
      async function measure(label) {
        const geometry=await page.evaluate(()=>({width:innerWidth,html:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
        receipt.checks.push({profile:name,label,...geometry,passed:Math.max(geometry.html,geometry.body)<=geometry.width+1});
        if(Math.max(geometry.html,geometry.body)>geometry.width+1)receipt.failures.push(`${name}:${label}:horizontal overflow`);
      }
      async function shot(label) {
        const path=resolve(outputDir,`${name}-${label}.png`);
        await page.screenshot({path,fullPage:true});receipt.screenshots.push({profile:name,label,path});
      }
      for(const [width,height]of sizes) {
        await page.setViewportSize({width,height});
        if(projectPath) {
          await goto(projectPath);
          await measure(`project-${width}x${height}`);
          const overview=page.getByRole("tab",{name:"Общее",exact:true});
          if(await overview.isVisible())await overview.click();
          // Any old project currency trigger would expose BYN/USD/RUB/EUR in overview.
          const visiblePanel=page.getByRole("tabpanel").first();
          assert.equal(await visiblePanel.locator('[data-slot="select-trigger"]').filter({hasText:/^(BYN|USD|RUB|EUR)$/}).count(),0,"PROJECT_CURRENCY_SELECTOR_PRESENT");
          await shot(`project-${width}x${height}`);
          if(finance&&width===1440) {
            const tab=page.getByRole("tab",{name:"Финансы",exact:true});
            if(await tab.isVisible()) {
              await tab.click();
              const open=page.getByRole("button",{name:"Добавить приход",exact:true});
              if(await open.isVisible()) {
                await open.click();
                const dialog=page.getByRole("dialog");
                await dialog.waitFor();
                const triggers=dialog.locator('[data-slot="select-trigger"]');
                let currencyTrigger=null;
                for(let i=0;i<await triggers.count();i++) {
                  const candidate=triggers.nth(i);
                  if(/^(BYN|USD|RUB|EUR)$/.test((await candidate.innerText()).trim()))currencyTrigger=candidate;
                }
                if(currencyTrigger) {
                  await currencyTrigger.click();
                  for(const currency of ["BYN","USD","RUB","EUR"])await expect(page.getByRole("option",{name:currency,exact:true}),"PHYSICAL_CURRENCY_OPTION_MISSING").toBeVisible({timeout:10000});
                  await page.keyboard.press("Escape");
                  receipt.checks.push({profile:name,label:"physical currency options BYN/USD/RUB/EUR preserved",passed:true});
                }else receipt.skips.push(`${name}: physical currency selector unavailable; inspect screenshot`);
                if(await dialog.getByText(/Нет кассы в/).isVisible())receipt.skips.push(`${name}: no cash account in selected currency; currency options tested, physical operation not submitted`);
                await shot("physical-payment-form");
                await dialog.getByRole("button",{name:"Отмена",exact:true}).click();
              }
            }
          }
        }else if(width===320)receipt.skips.push(`${name}: existing project path unavailable`);
        await goto("/projects");
        if(manage) {
          await page.getByRole("button",{name:"Проект",exact:true}).click();
          const dialog=page.getByRole("dialog");await dialog.waitFor();
          assert.ok(await dialog.getByRole("heading",{name:"Новый проект"}).isVisible());
          assert.equal(await dialog.getByText("Валюта",{exact:true}).count(),0,"CREATE_PROJECT_CURRENCY_PRESENT");
          const title=dialog.locator("#title");
          await title.fill("Очень длинное название заказа для проверки переноса и доступности элементов формы создания проекта без сохранения");
          await measure(`create-project-${width}x${height}`);await shot(`create-project-${width}x${height}`);
          await dialog.getByRole("button",{name:"Отмена",exact:true}).click();
        }else {
          assert.equal(await page.getByRole("button",{name:"Проект",exact:true}).count(),0,"RESTRICTED_ROLE_CREATE_PROJECT_VISIBLE");
          await measure(`projects-${width}x${height}`);
        }
        if(name==="admin") {
          await goto("/settings/payroll");
          assert.ok(await page.getByText("BYN — белорусский рубль",{exact:true}).isVisible());
          assert.equal(await page.locator('[data-slot="select-trigger"]').count(),0,"PAYROLL_CURRENCY_SELECTOR_PRESENT");
          assert.equal(await page.getByRole("button",{name:"Сохранить",exact:true}).count(),0,"PAYROLL_CURRENCY_SAVE_PRESENT");
          await measure(`payroll-settings-${width}x${height}`);await shot(`payroll-settings-${width}x${height}`);
          if(width===320) {
            const trigger=page.locator('[data-sidebar="trigger"]');
            await trigger.click();await page.locator('[data-mobile="true"][data-sidebar="sidebar"]').waitFor();await measure("mobile-sidebar-open");await shot("mobile-sidebar-open");await page.keyboard.press("Escape");await page.locator('[data-mobile="true"][data-sidebar="sidebar"]').waitFor({state:"hidden"});
            receipt.checks.push({profile:name,label:"mobile sidebar opened and closed",passed:true});
          }
          if(width===1440) {
            await page.evaluate(()=>{document.documentElement.style.zoom="2";});
            await measure("payroll-settings-CSS-zoom200");await shot("payroll-settings-CSS-zoom200");
            await page.evaluate(()=>{document.documentElement.style.zoom="";});
          }
        }
      }
      for(const error of errors)receipt.failures.push(`${name}:${error}`);
      await Promise.allSettled([...pending]);
      await context.close();
    }
    receipt.status=receipt.failures.length===0&&receipt.mutationsBlocked.length===0?"PASS":"FAIL";
    receipt.passed=receipt.failures.length===0&&receipt.mutationsBlocked.length===0;
    await writeFile(resolve(outputDir,"crm-byn-browser-receipt.json"),JSON.stringify(receipt,null,2));
    return receipt;
  }catch(error){
    if(activePage&&!activePage.isClosed()) {
      const path=resolve(outputDir,`${activeProfile??"probe"}-failure.png`);
      await activePage.screenshot({path,fullPage:true}).then(()=>receipt.screenshots.push({profile:activeProfile,label:"failure",path})).catch(()=>{});
      const text=await activePage.locator("body").innerText().catch(()=>"DOM_TEXT_UNAVAILABLE");
      await writeFile(resolve(outputDir,"crm-byn-failure-dom.txt"),text,{mode:0o600}).catch(()=>{});
    }
    receipt.failures.push(`PROBE_STOP:${error instanceof assert.AssertionError ? error.message.split("\n")[0] : "browser operation failed"}`);
    receipt.status=receipt.failures.length===0&&receipt.mutationsBlocked.length===0?"PASS":"FAIL";
    receipt.status="FAIL";
    receipt.passed=false;
    await Promise.allSettled([...pending]);
    receipt.ownWrites=[...own.values()];
    await writeFile(resolve(outputDir,"crm-byn-browser-receipt.json"),JSON.stringify(receipt,null,2));
    return receipt;
  }finally{await browser.close();}
}
export default runCrmBynBrowser;
