// Actual compiled UI on root-created owned fixtures. Never runs automatically.
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";

const VIEWPORTS=[[320,800],[360,800],[390,844],[768,1024],[1024,768],[1440,900]];
const FIELDS=new Set(["title","kind","quantity","expectedPrice","engineerId","description","project.clientId","project.address","client.phone"]);
const outcomeRows=(body)=>body.toString("utf8").split("\n").flatMap(line=>{try{return[JSON.parse(line.slice(line.indexOf(":")+1))];}catch{return[];}});
export async function runProductInlineBrowser({origin,profiles,fixture,outputDir,basicAuth,onOwnWrites}) {
  assert.ok(["http://127.0.0.1:3017","https://staging-crm.peromebel.by"].includes(origin)&&outputDir,"REVIEWED_LOCAL_OR_STAGING_ORIGIN_REQUIRED");
  assert.ok(fixture?.ids?.productA&&fixture.ids.productB&&fixture.ids.clientA&&fixture.ids.clientB,"OWNED_FIXTURE_MANIFEST_REQUIRED");
  assert.ok(profiles?.admin?.id&&profiles.admin.cookies?.length,"ADMIN_SESSION_PROFILE_REQUIRED");
  const allowedProducts=new Set([fixture.ids.productA,fixture.ids.productB]);
  const paths=fixture.paths??{productA:`/products/${encodeURIComponent(fixture.ids.productA)}`,productB:`/products/${encodeURIComponent(fixture.ids.productB)}`};
  for(const path of [paths.productA,paths.productB])assert.ok(/^\/products\/[^/]+$/.test(path),"OWNED_PRODUCT_PATH_REQUIRED");
  await mkdir(outputDir,{recursive:true});
  const receipt={kind:"product-inline-compiled-browser",origin,status:"FAIL",passed:false,checks:[],screenshots:[],skips:[],failures:[],requests:[],ownWrites:[],preferenceOwnWrites:[],authentication:"caller supplied short-lived sessions; password login not tested",pageErrors:[],serviceWorkerMode:"native allow",networkScope:"actual Next Action Flight response; compact DTO required, not zero Flight encoding"};
  const browser=await chromium.launch({headless:true});
  const contexts=new Map();const pending=new Set();const own=new Map();const preferences=new Map();
  let page;let activeProfile="admin";let phase="session_setup";let bellActionId;let delayPlan=null;let abortField=null;let statusPermit=false;const releases=[];
  let persistence = Promise.resolve();
  function persist() {
    const job = persistence.then(async () => {
    receipt.ownWrites=[...own.values()];receipt.preferenceOwnWrites=[...preferences.values()];
    const path=resolve(outputDir,"product-inline-owned-writes.json");
    await writeFile(`${path}.tmp`,JSON.stringify({ownWrites:receipt.ownWrites,preferenceOwnWrites:receipt.preferenceOwnWrites}),{mode:0o600});await rename(`${path}.tmp`,path);
    if(onOwnWrites)await onOwnWrites({ownWrites:receipt.ownWrites,preferenceOwnWrites:receipt.preferenceOwnWrites});
    await writeFile(resolve(outputDir,"product-inline-request-journal.json"),JSON.stringify(receipt.requests,null,2),{mode:0o600});
    });
    persistence = job.catch(()=>{});
    return job;
  }
  function check(label,detail={}){receipt.checks.push({label,passed:true,...detail});}
  async function startContext(name,profile) {
    const context=await browser.newContext({viewport:{width:1440,height:900},httpCredentials:basicAuth,serviceWorkers:"allow"});
    await context.addCookies(profile.cookies);
    const session=await context.request.get(`${origin}/api/auth/session`);
    assert.equal(session.status(),200,"PROFILE_SESSION_HTTP_FAILED");
    const data=await session.json();assert.equal(data?.user?.id,profile.id,"PROFILE_ACTOR_MISMATCH");
    if(profile.roles)assert.deepEqual([...data.user.roles].sort(),[...profile.roles].sort(),"PROFILE_ROLES_MISMATCH");
    let closing=false;
    await context.route("**/*",async route=>{
      const request=route.request();const url=new URL(request.url());
      if(["GET","HEAD","OPTIONS"].includes(request.method())){await route.continue();return;}
      let args;try{args=JSON.parse(request.postData()??"");}catch{}
      const action=request.headers()["next-action"];
      const appPage=url.origin===origin&&[paths.productA,paths.productB].includes(url.pathname);
      const patch=Array.isArray(args)&&args.length===1&&args[0]&&typeof args[0]==="object"?args[0]:null;
      const closed=patch&&allowedProducts.has(patch.productId)&&FIELDS.has(patch.field)&&/^[0-9a-f-]{36}$/i.test(patch.clientMutationId??"")&&Object.keys(patch).every(key=>["productId","field","value","expectedValue","clientMutationId","expectedClientId"].includes(key));
      const status=Array.isArray(args)&&args.length===2&&allowedProducts.has(args[0])&&["RECLAMATION","DESIGN"].includes(args[1])&&statusPermit;
      const list=Array.isArray(args)&&args.length===3&&args[0]==="projects"&&typeof args[1]==="string"&&(args[2]===null||typeof args[2]==="string");
      const tab=Array.isArray(args)&&args.length===2&&args[0]==="project.tab"&&["overview","finance"].includes(args[1]);
      const empty=Array.isArray(args)&&args.length===0;
      // Source-verified NotificationsBell mount/poll; pin its action ID.
      if(appPage&&action&&empty)bellActionId??=action;
      const read=empty&&action===bellActionId;
      if(!closing&&appPage&&action&&request.method()==="POST"&&(closed||status||read||list||tab)) {
        if(read){await route.continue();return;}
        const record={profile:name,actorId:profile.id,type:closed?"patch":status?"status":"preference",path:url.pathname,request:closed?{...patch}:status?{productId:args[0],toStatus:args[1]}:{args},phase:"requested"};
        receipt.requests.push(record);
        const loseResponse=closed&&abortField===patch.field;
        if(loseResponse)abortField=null;
        const delayed=closed&&delayPlan?.field===patch.field?delayPlan:null;
        if(delayed)delayPlan=null;
        const task=(async()=>{
          const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:30000});const body=await response.body();
          record.httpStatus=response.status();record.bytes=body.length;record.contentType=response.headers()["content-type"];record.phase="response-captured";
          const rows=outcomeRows(body);const matches=closed?rows.filter(value=>value?.clientMutationId===patch.clientMutationId&&typeof value.kind==="string"):rows.filter(value=>typeof value?.ok==="boolean");
          assert.equal(response.status(),200,"ACTION_HTTP_FAILED");assert.equal(matches.length,1,"ACTION_RESULT_NOT_CAPTURED");
          const outcome=matches[0];record.result=outcome;
          if(closed){
            record.compact=body.length<20000&&!body.toString("utf8").includes('"children"')&&!/statusHistory|expenseBreakdown|materialsData|ProductCoverClient/.test(body.toString("utf8"));
            if(outcome.kind==="saved")own.set(patch.clientMutationId,{actorId:profile.id,productId:patch.productId,field:patch.field,value:outcome.value,clientMutationId:patch.clientMutationId,noOp:Boolean(outcome.noOp),auditLookupKey:outcome.noOp?null:`product-inline:${patch.clientMutationId}`});
            assert.ok(record.compact,"FULL_CARD_FLIGHT_RETURNED_FOR_FIELD");
          }else if(status&&outcome.ok)own.set(`status:${receipt.requests.length}`,{actorId:profile.id,productId:args[0],toStatus:args[1],type:"status",saved:true});
          else if((list||tab)&&outcome.ok){
            const key=list?"projects.list":"project.tab";const value=list?outcome.value:args[1];
            if(list){const parsed=JSON.parse(value);assert.equal(parsed.version,1);assert.match(parsed.revision,/^[0-9a-f-]{36}$/i);}
            preferences.set(`${profile.id}/${key}`,{userId:profile.id,key,value});
          }
          await persist();
          if(loseResponse){record.phase="response-lost-after-upstream-commit";await persist();await route.abort("failed");return;}
          if(delayed){delayed.captured=true;await delayed.gate;}
          await route.fulfill({response,body});
        })();pending.add(task);try{await task;}catch{receipt.failures.push(`ACTION_CAPTURE_FAILED:${name}`);await route.abort("blockedbyclient").catch(()=>{});}finally{pending.delete(task);}return;
      }
      if(!closing)receipt.failures.push(`UNAUTHORIZED_MUTATION_BLOCKED:${name}:${url.pathname}`);
      await route.abort("blockedbyclient");
    });
    const current=await context.newPage();
    const network=[];current.on("request",request=>{
      const url=new URL(request.url());const prefetch=request.headers()["next-router-prefetch"]||request.headers()["purpose"]==="prefetch";
      if(!prefetch&&request.method()==="GET"&&[paths.productA,paths.productB].includes(url.pathname)&&(request.isNavigationRequest()||request.headers()["rsc"]||url.searchParams.has("_rsc")))network.push({path:url.pathname,kind:request.isNavigationRequest()?"document":"RSC"});
      if(/nbrb|exrates/i.test(url.hostname+url.pathname))receipt.failures.push("UNEXPECTED_CLIENT_FX_REQUEST");
    });
    current.on("pageerror",error=>{
      const redact=value=>String(value??"").replace(/Bearer\s+[A-Za-z0-9._-]+/gi,"Bearer [REDACTED_SECRET]").replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,"[REDACTED_SECRET]");
      receipt.pageErrors.push({profile:name,phase,name:error.name,message:redact(error.message).slice(0,1500),stack:redact(error.stack).slice(0,4000)});
      receipt.failures.push(`PAGE_ERROR:${name}`);
      void writeFile(resolve(outputDir,"product-inline-page-errors.json"),JSON.stringify(receipt.pageErrors,null,2),{mode:0o600}).catch(()=>{});
    });
    current.on("response",response=>{if(response.status()>=400)receipt.failures.push(`HTTP_ERROR:${name}:${response.status()}:${new URL(response.url()).pathname}`);});
    contexts.set(name,{context,page:current,network,close:async()=>{closing=true;await context.close();}});return contexts.get(name);
  }
  const field=(p,id)=>p.locator(`#product-inline-${id}`);
  const state=(p,id)=>p.locator(`#product-inline-${id}-state`);
  async function goto(p,path){const response=await p.goto(`${origin}${path}`,{waitUntil:"networkidle"});assert.equal(response.status(),200,"PRODUCT_HTTP_FAILED");assert.equal(new URL(p.url()).pathname,path,"PRODUCT_SESSION_OR_ACCESS_FAILED");await field(p,"title").waitFor();}
  async function saved(p,id){await expect(state(p,id).getByText("Сохранено",{exact:true})).toBeVisible({timeout:15000});}
  async function enter(p,id,value){await field(p,id).fill(value);await field(p,id).press("Enter");await saved(p,id);}
  const patches=()=>receipt.requests.filter(request=>request.type==="patch");
  async function selectClient(p,label){await field(p,"client").click();await p.getByRole("button").filter({has:p.getByText(label,{exact:true})}).click();await saved(p,"client");}
  async function geometry(p,label){const measured=await p.evaluate(()=>({width:innerWidth,body:document.body.scrollWidth,html:document.documentElement.scrollWidth}));assert.ok(Math.max(measured.body,measured.html)<=measured.width+1,"PAGE_HORIZONTAL_OVERFLOW");check(label,measured);}
  async function screenshot(p,label){const path=resolve(outputDir,`${label}.png`);await p.screenshot({path,fullPage:true});receipt.screenshots.push({label,path});}
  try {
    const admin=await startContext("admin",profiles.admin);page=admin.page;
    const secondaryProfile=[profiles.manager,profiles.combined].find(profile=>profile?.roles?.some(role=>["ADMIN","DIRECTOR","MANAGER"].includes(role)))??profiles.admin;
    if(secondaryProfile.id===profiles.admin.id)receipt.skips.push("second authorized actor unavailable: two contexts test same actor, not two-user acceptance");
    const secondary=await startContext("second-editor",secondaryProfile);
    await goto(page,paths.productA);await goto(secondary.page,paths.productA);
    phase="one_field_dedupe_compact";
    const initialCount=patches().length;const initialNavigation=admin.network.length;
    await field(page,"title").fill("QA inline one field");await field(page,"title").press("Enter");await field(page,"title").press("Tab");await saved(page,"title");
    assert.equal(patches().length-initialCount,1,"ENTER_BLUR_DOUBLE_POST");assert.equal(admin.network.length,initialNavigation,"FIELD_TRIGGERED_EXTRA_DOCUMENT_OR_RSC");
    const noOpCount=patches().length;await field(page,"title").press("Enter");await field(page,"title").press("Tab");await saved(page,"title");assert.equal(patches().length,noOpCount,"NO_OP_POST_SENT");check("one field compact response, Enter+blur dedupe, unchanged no POST, no extra navigation/RSC");
    phase="slow_response_new_draft_neighbor";
    let release;const plan={field:"title",captured:false,gate:new Promise(done=>{release=done;})};releases.push(()=>release());delayPlan=plan;
    await field(page,"title").fill("QA slow confirmed value");await field(page,"title").press("Enter");await expect.poll(()=>plan.captured).toBe(true);
    await field(page,"title").fill("QA newer local draft");
    const prior=patches().filter(request=>request.request.field==="title").length;
    await new Promise(done=>setTimeout(done,850));assert.equal(patches().filter(request=>request.request.field==="title").length,prior,"KEYSTROKE_SURPRISE_POST");
    release();await expect(field(page,"title")).toHaveValue("QA newer local draft");await expect(state(page,"title").getByText("Есть изменения")).toBeVisible();
    await field(page,"title").press("Enter");await saved(page,"title");
    let releaseNeighbor;const neighborPlan={field:"title",captured:false,gate:new Promise(done=>{releaseNeighbor=done;})};releases.push(()=>releaseNeighbor());delayPlan=neighborPlan;
    await field(page,"title").fill("QA title while neighbor saves");await field(page,"title").press("Enter");await expect.poll(()=>neighborPlan.captured).toBe(true);
    await enter(page,"kind","QA independent neighbor");
    assert.ok(patches().some(request=>request.request.field==="kind"&&request.result?.kind==="saved"));
    releaseNeighbor();await saved(page,"title");
    check("delayed committed response preserves newer draft, explicit next save, neighboring field saves while title acknowledgement waits");
    phase="two_editors_same_and_different_fields";
    await goto(page,paths.productA);await goto(secondary.page,paths.productA);
    await field(page,"title").fill("QA race winner");await field(secondary.page,"title").fill("QA race challenger");await field(page,"title").press("Enter");await saved(page,"title");
    await field(secondary.page,"title").press("Enter");await expect(state(secondary.page,"title").getByText(/изменено другим/)).toBeVisible();await expect(field(secondary.page,"title")).toHaveValue("QA race challenger");
    await state(secondary.page,"title").getByRole("button",{name:"Сохранить мой ввод",exact:true}).click();await saved(secondary.page,"title");
    await Promise.all([enter(page,"kind","QA different field A"),(async()=>{await field(secondary.page,"description").fill("QA different field B\nsecond line");await field(secondary.page,"description").press("Control+Enter");await saved(secondary.page,"description");})()]);check("same-field conflict retains input and explicit retry; separate fields both save");
    phase="validation_zero_null";
    await goto(page,paths.productA);
    for(const [id,bad,good]of [["title","",await field(page,"title").inputValue()],["quantity","0","1"],["price","10.999","10.01"]]){
      const count=patches().length;await field(page,id).fill(bad);await field(page,id).press("Enter");await expect(state(page,id).getByRole("alert")).toBeVisible();assert.equal(patches().length,count,"INVALID_LOCAL_VALUE_SENT");await enter(page,id,good);
    }
    await enter(page,"price","0");assert.equal(patches().at(-1).result.value,"0.00");await enter(page,"price","");assert.equal(patches().at(-1).result.value,null);check("blank title, quantity0, >2decimal errors; price0 and null distinct");
    phase="transport_failure_same_mutation_id";
    abortField="project.address";await field(page,"address").fill("QA address after retry");await field(page,"address").press("Enter");await expect(state(page,"address").getByRole("alert")).toBeVisible();
    const aborted=patches().at(-1);assert.equal(aborted.phase,"response-lost-after-upstream-commit");assert.equal(aborted.result.kind,"saved");await state(page,"address").getByRole("button",{name:"Повторить сохранение",exact:true}).click();await saved(page,"address");assert.equal(patches().at(-1).request.clientMutationId,aborted.request.clientMutationId);assert.equal(patches().at(-1).result.repeated,true,"LOST_RESPONSE_RETRY_DID_NOT_REPLAY_RECEIPT");check("lost response after actual commit retries identical UUID/payload and returns saved receipt replay");
    phase="changed_client_phone_context";
    await goto(page,paths.productA);await goto(secondary.page,paths.productA);
    await field(page,"phone").fill("777");
    await selectClient(secondary.page,fixture.initial.clientLabelB);
    await field(page,"phone").press("Enter");await expect(state(page,"phone").getByText(/Клиент проекта изменён/)).toBeVisible();await expect(field(page,"phone")).toHaveValue("777");
    await expect(state(page,"phone").getByText(`Сейчас сохранено: ${fixture.initial.phoneB}`,{exact:true})).toBeVisible();
    await state(page,"phone").getByRole("button",{name:"Принять сохранённое",exact:true}).click();await expect(field(page,"phone")).toHaveValue(fixture.initial.phoneB);
    await enter(page,"phone","888");assert.equal(patches().at(-1).request.expectedClientId,fixture.ids.clientB);
    await selectClient(page,fixture.initial.clientLabelA);await expect(field(page,"phone")).toHaveValue(fixture.initial.phoneA);check("changed-client conflict keeps old draft, explicit accept binds actual phone; original client phone unchanged");
    phase="pristine_engineer_fallback_projection";
    await page.getByRole("tab",{name:"Процентные этапы",exact:true}).click();
    const engineerSelect=field(page,"engineer");
    const originalEngineerName=(await engineerSelect.innerText()).trim();
    await engineerSelect.click();
    const engineerOptions=page.locator('[data-slot="popover-content"]').getByRole("button");
    let alternateEngineerName=null;
    for(let index=0;index<await engineerOptions.count();index++){
      const candidate=engineerOptions.nth(index);const label=(await candidate.innerText()).trim();
      if(label&&label!==originalEngineerName&&!label.startsWith("—")&&await candidate.isEnabled()) {alternateEngineerName=label;await candidate.click();break;}
    }
    if(alternateEngineerName){
      await saved(page,"engineer");
      const engineeringCard=page.locator('[data-slot="card"]').filter({has:page.getByText("Инженерный этап",{exact:true})});
      await expect(engineeringCard.getByText(alternateEngineerName,{exact:true})).toBeVisible();
      const engineerRequest=patches().at(-1);assert.equal(engineerRequest.request.field,"engineerId");assert.notEqual(engineerRequest.request.value,fixture.initial.engineerId);
      await engineerSelect.click();await page.locator('[data-slot="popover-content"]').getByRole("button").filter({has:page.getByText(originalEngineerName,{exact:true})}).click();
      await saved(page,"engineer");await expect(engineeringCard.getByText(originalEngineerName,{exact:true})).toBeVisible();
      assert.equal(patches().at(-1).request.value,fixture.initial.engineerId);
      check("pristine DRAFT server-fallback recipient follows confirmed alternative engineer and revert; no percentage config written");
    }else{await page.keyboard.press("Escape");receipt.skips.push("alternative active engineer unavailable: default projection runtime scenario not executed");}
    await page.getByRole("tab",{name:/Работы и задачи/}).click();
    phase="dependent_flush_before_status";
    let releaseQuantity;const quantityPlan={field:"quantity",captured:false,gate:new Promise(done=>{releaseQuantity=done;})};releases.push(()=>releaseQuantity());delayPlan=quantityPlan;
    await field(page,"quantity").fill("2");await field(page,"quantity").press("Enter");await expect.poll(()=>quantityPlan.captured).toBe(true);
    await field(page,"price").fill("20.02");statusPermit=true;const beforeStatus=receipt.requests.filter(request=>request.type==="status").length;
    await page.getByLabel("Сменить статус",{exact:true}).click();await page.getByRole("option",{name:"Рекламация",exact:true}).click();await saved(page,"price");
    assert.equal(receipt.requests.filter(request=>request.type==="status").length,beforeStatus,"STATUS_POST_BEFORE_DEPENDENT_ACK");releaseQuantity();
    await expect.poll(()=>receipt.requests.filter(request=>request.type==="status"&&request.result?.ok).length).toBe(beforeStatus+1);
    await expect(page.getByLabel("Сменить статус",{exact:true})).toContainText("Рекламация");statusPermit=false;check("price/quantity acknowledgements precede DESIGN→RECLAMATION, no completion/production transition");
    phase="percentage_dirty_guard";
    await page.getByRole("tab",{name:"Процентные этапы",exact:true}).click();const rate=page.locator("#ENGINEERING-rate");
    if(await rate.isVisible()){
      await rate.fill("5");await page.getByRole("tab",{name:/Работы и задачи/}).click();const statuses=receipt.requests.filter(request=>request.type==="status").length;statusPermit=true;
      await page.getByLabel("Сменить статус",{exact:true}).click();await page.getByRole("option",{name:"Проектирование",exact:true}).click();
      await expect(page.getByRole("alert").filter({hasText:/Сначала сохраните/})).toBeVisible();assert.equal(receipt.requests.filter(request=>request.type==="status").length,statuses,"DIRTY_PERCENTAGE_SENT_STATUS");statusPermit=false;check("hidden dirty existing percentage config blocks status; no config saved");
    }else receipt.skips.push("existing engineering percentage config not editable; dirty-panel scenario unavailable");
    phase="roles_and_geometry";
    for(const [name,profile]of Object.entries(profiles)){
      assert.match(name,/^[a-zA-Z0-9_-]+$/,"SAFE_PROFILE_LABEL_REQUIRED");
      if(!profile?.cookies?.length){receipt.skips.push(`${name}: session unavailable`);continue;}
      const current=name==="admin"?admin:await startContext(`role-${name}`,profile);activeProfile=name;page=current.page;
      const manager=profile.roles.some(role=>["ADMIN","DIRECTOR","MANAGER"].includes(role));
      const path=name==="engineer"?paths.productB:paths.productA;await goto(page,path);
      if(name==="admin")await enter(page,"title","QA очень длинное название изделия для проверки прямого редактирования и размещения соседних элементов без выхода карточки за границы экрана");
      assert.equal(await field(page,"title").getAttribute("readonly")!==null,!manager,"TITLE_ROLE_EDITABILITY_MISMATCH");assert.equal(await field(page,"phone").getAttribute("readonly")!==null,!manager,"PHONE_ROLE_EDITABILITY_MISMATCH");
      if(name==="engineer"){
        if(await field(page,"description").getAttribute("readonly")===null){await field(page,"description").fill("QA assigned engineer technical change");await field(page,"description").press("Control+Enter");await saved(page,"description");check("assigned DESIGN engineer saves own technical field");}else receipt.skips.push("engineer fixture not assigned/editable; no claim of technical writer acceptance");
      }
      if(name==="admin"){await field(page,"quantity").fill("0");await field(page,"quantity").press("Enter");await expect(state(page,"quantity").getByRole("alert")).toBeVisible();}
      for(const [width,height]of VIEWPORTS){
        await page.setViewportSize({width,height});
        await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
        await geometry(page,`${name}-${width}x${height}`);await screenshot(page,`${name}-${width}x${height}`);
        if(name==="admin"){
          const trigger=page.getByLabel("Открыть меню",{exact:true});
          if(width<768){
            await trigger.click();await page.locator('[data-mobile="true"][data-slot="sidebar"]').waitFor();
            await geometry(page,`admin-sidebar-open-${width}`);await screenshot(page,`admin-sidebar-open-${width}`);
            await page.keyboard.press("Escape");await page.locator('[data-mobile="true"][data-slot="sidebar"]').waitFor({state:"hidden"});
            await geometry(page,`admin-sidebar-closed-${width}`);
          }else{
            const sidebar=page.locator('[data-slot="sidebar"][data-state]');
            if(await sidebar.getAttribute("data-state")!=="expanded")await trigger.click();
            await expect(sidebar).toHaveAttribute("data-state","expanded");await geometry(page,`admin-sidebar-expanded-${width}`);await screenshot(page,`admin-sidebar-expanded-${width}`);
            await trigger.click();await expect(sidebar).toHaveAttribute("data-state","collapsed");await geometry(page,`admin-sidebar-collapsed-${width}`);await screenshot(page,`admin-sidebar-collapsed-${width}`);
          }
        }
      }
      if(name==="admin")await enter(page,"quantity","2");
    }
    phase="smooth_width_and_native_worker";
    page=admin.page;activeProfile="admin";
    for(let width=320;width<=1440;width+=40){
      await page.setViewportSize({width,height:900});
      await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
      await geometry(page,`admin-smooth-width-${width}`);
    }
    receipt.serviceWorker=await page.evaluate(async()=>({supported:"serviceWorker" in navigator,controller: navigator.serviceWorker.controller?.scriptURL??null,registrations:(await navigator.serviceWorker.getRegistrations()).map(registration=>({scope:registration.scope,active:registration.active?.scriptURL??null,waiting:Boolean(registration.waiting)}))}));
    assert.ok(receipt.serviceWorker.supported&&receipt.serviceWorker.registrations.some(registration=>registration.active),"NATIVE_SERVICE_WORKER_NOT_REGISTERED");
    check("native Serwist registration succeeds; Server Action POSTs remain guarded and journaled");
    await Promise.allSettled([...pending]);await persist();
    assert.ok(receipt.requests.filter(request=>request.type==="patch"&&request.result).every(request=>request.compact),"FIELD_RESPONSE_COMPACT_PROOF_FAILED");
    receipt.status=receipt.failures.length?"FAIL":"PASS";receipt.passed=receipt.status==="PASS";
  }catch(error){
    receipt.failures.push({code:"PRODUCT_INLINE_BROWSER_STOP",phase,errorType:error?.name??"Error"});
    if(page&&!page.isClosed()){await screenshot(page,`${activeProfile}-failure`).catch(()=>{});await writeFile(resolve(outputDir,"product-inline-failure-dom.txt"),await page.locator("body").innerText().catch(()=>"DOM_UNAVAILABLE"),{mode:0o600}).catch(()=>{});}
  }finally{
    for(const release of releases)release();
    await Promise.allSettled([...pending]);for(const item of contexts.values())await item.close().catch(()=>{});await browser.close();await persist();
    await writeFile(resolve(outputDir,"product-inline-browser-receipt.json"),JSON.stringify(receipt,null,2),{mode:0o600});
  }
  return receipt;
}
export default runProductInlineBrowser;
