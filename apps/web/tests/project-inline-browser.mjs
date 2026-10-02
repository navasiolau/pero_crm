// Actual compiled UI on root-created owned fixtures. Never runs automatically.
import assert from "node:assert/strict";
import sharp from "sharp";
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";

const VIEWPORTS=[[320,800],[360,800],[390,844],[768,1024],[1024,768],[1440,900]];
const FIELDS=new Set(["title","clientId","managerId","address","client.phone","delivery","unloading","installation"]);
const outcomeRows=(body)=>body.toString("utf8").split("\n").flatMap(line=>{try{return[JSON.parse(line.slice(line.indexOf(":")+1))];}catch{return[];}});
export async function runProjectInlineBrowser({origin,profiles,fixture,outputDir,basicAuth,onOwnWrites,onOwnFiles,apiProbe}) {
  assert.ok(["http://127.0.0.1:3018","https://staging-crm.peromebel.by"].includes(origin)&&outputDir,"REVIEWED_LOCAL_OR_STAGING_ORIGIN_REQUIRED");
  assert.ok(fixture?.ids?.project&&fixture.ids.clientA&&fixture.ids.clientB,"OWNED_PROJECT_FIXTURE_REQUIRED");
  assert.ok(profiles?.admin?.id&&profiles.admin.cookies?.length,"ADMIN_SESSION_PROFILE_REQUIRED");
  const ownedProject=fixture.ids.project;
  const path=fixture.paths?.project??`/projects/${encodeURIComponent(ownedProject)}`;
  assert.ok(/^\/projects\/[^/]+$/.test(path),"OWNED_PROJECT_PATH_REQUIRED");
  await mkdir(outputDir,{recursive:true});
  const receipt={kind:"project-inline-compiled-browser",origin,status:"FAIL",passed:false,checks:[],screenshots:[],skips:[],failures:[],requests:[],ownWrites:[],preferenceOwnWrites:[],authentication:"caller supplied short-lived sessions; password login not tested",pageErrors:[],serviceWorkerMode:"native allow",browserMode:"Chromium new headless (PDF-capable); not headless-shell",networkScope:"actual Next Action Flight response; compact DTO required, not zero Flight encoding"};
  const browser=await chromium.launch({headless:true,channel:"chromium"});
  const contexts=new Map();const pending=new Set();const own=new Map();const preferences=new Map();const deliveryRequests=new WeakMap();
  let page;let activeProfile="admin";let phase="session_setup";let substep="start";let bellActionId;let delayPlan=null;let abortField=null;let statusPermit=false;let deletePermit=null;const releases=[];const uploadedFileIds=new Set();
  let persistence = Promise.resolve();
  function persist() {
    const job = persistence.then(async () => {
    receipt.ownWrites=[...own.values()];receipt.preferenceOwnWrites=[...preferences.values()];
    const path=resolve(outputDir,"project-inline-owned-writes.json");
    await writeFile(`${path}.tmp`,JSON.stringify({ownWrites:receipt.ownWrites,preferenceOwnWrites:receipt.preferenceOwnWrites}),{mode:0o600});await rename(`${path}.tmp`,path);
    if(onOwnWrites)await onOwnWrites({ownWrites:receipt.ownWrites,preferenceOwnWrites:receipt.preferenceOwnWrites});
    await writeFile(resolve(outputDir,"project-inline-request-journal.json"),JSON.stringify(receipt.requests,null,2),{mode:0o600});
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
    let closing=false;const expectedDenial=profile.roles?.some(role=>["WORKER","MOUNTER"].includes(role))&&!profile.roles.some(role=>["ADMIN","DIRECTOR","MANAGER","ENGINEER","ACCOUNTANT"].includes(role));
    await context.route("**/*",async route=>{
      const request=route.request();const url=new URL(request.url());
      if(["GET","HEAD","OPTIONS"].includes(request.method())){await route.continue();return;}
      let args;try{args=JSON.parse(request.postData()??"");}catch{}
      const action=request.headers()["next-action"];
      const appPage=url.origin===origin&&url.pathname===path;
      const patch=Array.isArray(args)&&args.length===1&&args[0]&&typeof args[0]==="object"?args[0]:null;
      const closed=patch&&patch.projectId===ownedProject&&FIELDS.has(patch.field)&&/^[0-9a-f-]{36}$/i.test(patch.clientMutationId??"")&&Object.keys(patch).every(key=>["projectId","field","value","expectedValue","clientMutationId","expectedClientId"].includes(key));
      const status=patch&&patch.projectId===ownedProject&&["LEAD","REFUSED","RECLAMATION"].includes(patch.toStage)&&statusPermit&&!patch.field;
      const deletion=Array.isArray(args)&&args.length===1&&typeof args[0]==="string"&&args[0]===deletePermit&&uploadedFileIds.has(args[0]);
      if(url.origin===origin&&url.pathname==="/api/files/upload"&&request.method()==="POST"){
        const form=await new Request("https://qa.invalid",{method:"POST",headers:{"content-type":request.headers()["content-type"]},body:request.postDataBuffer()}).formData();
        assert.equal(form.get("projectId"),ownedProject,"UPLOAD_TARGET_NOT_OWNED");assert.ok(!form.get("productId")&&!form.get("taskId"),"UPLOAD_BOUNDARY_NOT_PROJECT");
        const file=form.get("file");const ownedUploads=new Map([[`qa18-${ownedProject}-1.pdf`,"application/pdf"],[`qa18-${ownedProject}-2.pdf`,"application/pdf"],[`qa18-${ownedProject}-3.png`,"image/png"]]);
        assert.ok(file&&typeof file!=="string"&&ownedUploads.get(file.name)===file.type&&file.size<10000&&uploadedFileIds.size<3,"UPLOAD_FILE_NOT_OWNED_QA_MEDIA");
        const record={profile:name,actorId:profile.id,type:"file-upload",fileName:file.name,path:url.pathname,phase:"requested"};receipt.requests.push(record);
        const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:30000});const body=await response.body();record.httpStatus=response.status();record.result=JSON.parse(body.toString("utf8"));
        assert.equal(response.status(),200,"OWNED_FILE_UPLOAD_FAILED");assert.ok(record.result.ok&&record.result.id,"OWNED_FILE_ID_NOT_CAPTURED");uploadedFileIds.add(record.result.id);record.phase="response-captured";await persist();await route.fulfill({response,body});return;
      }
      const list=Array.isArray(args)&&args.length===3&&args[0]==="projects"&&typeof args[1]==="string"&&(args[2]===null||typeof args[2]==="string");
      const tab=Array.isArray(args)&&args.length===2&&args[0]==="project.tab"&&["overview","finance"].includes(args[1]);
      const empty=Array.isArray(args)&&args.length===0;
      // Source-verified NotificationsBell mount/poll; pin its action ID.
      if(appPage&&action&&empty)bellActionId??=action;
      const read=empty&&action===bellActionId;
      if(!closing&&appPage&&action&&request.method()==="POST"&&(closed||status||deletion||read||list||tab)) {
        if(read){await route.continue();return;}
        const record={profile:name,actorId:profile.id,type:closed?"patch":status?"status":deletion?"file-delete":"preference",path:url.pathname,request:closed||status?{...patch}:deletion?{fileId:args[0]}:{args},phase:"requested"};
        receipt.requests.push(record);
        if(closed)deliveryRequests.set(request,record);
        const loseResponse=closed&&abortField===patch.field;
        if(loseResponse)abortField=null;
        const delayed=closed&&delayPlan?.field===patch.field?delayPlan:null;
        if(delayed)delayPlan=null;
        const task=(async()=>{
          const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:30000});const body=await response.body();
          record.httpStatus=response.status();record.bytes=body.length;record.contentType=response.headers()["content-type"];record.phase="response-captured";
          if(closed){
            const headers=response.headers();
            record.responseFraming={decodedBodyBytes:body.length,headers:Object.fromEntries(["content-type","content-encoding","content-length","transfer-encoding"].filter(key=>headers[key]!==undefined).map(key=>[key,headers[key]]))};
          }
          const rows=outcomeRows(body);const matches=closed?rows.filter(value=>value?.clientMutationId===patch.clientMutationId&&typeof value.kind==="string"):rows.filter(value=>typeof value?.ok==="boolean");
          assert.equal(response.status(),200,"ACTION_HTTP_FAILED");assert.equal(matches.length,1,"ACTION_RESULT_NOT_CAPTURED");
          const outcome=matches[0];record.result=outcome;
          if(closed){
            record.compact=body.length<20000&&!body.toString("utf8").includes('"children"')&&!/statusHistory|expenseBreakdown|materialsData|ProductCoverClient/.test(body.toString("utf8"));
            if(outcome.kind==="saved")own.set(patch.clientMutationId,{actorId:profile.id,projectId:patch.projectId,field:patch.field,value:outcome.value,clientMutationId:patch.clientMutationId,noOp:Boolean(outcome.noOp),auditLookupKey:outcome.noOp?null:`project-inline:${patch.clientMutationId}`});
            assert.ok(record.compact,"FULL_CARD_FLIGHT_RETURNED_FOR_FIELD");
            const rawFlight=body.toString("utf8");
            if(!/Bearer\s+[A-Za-z0-9._-]+|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/i.test(rawFlight)){
              const filename=`project-inline-flight-${patch.clientMutationId}-${receipt.requests.indexOf(record)}.txt`;
              await writeFile(resolve(outputDir,filename),body,{mode:0o600});record.privateFlightArtifact=filename;
            }else record.privateFlightArtifactSkipped="SECRET_PATTERN";
          }else if(status&&outcome.ok)own.set(`status:${patch.clientMutationId}`,{actorId:profile.id,projectId:ownedProject,toStage:patch.toStage,clientMutationId:patch.clientMutationId,type:"status",saved:true,noOp:Boolean(outcome.noOp),replayed:Boolean(outcome.replayed)});
          else if(deletion&&outcome.ok)own.set(`file-delete:${args[0]}`,{actorId:profile.id,type:"file-delete",fileId:args[0],saved:true});
          else if((list||tab)&&outcome.ok){
            const key=list?"projects.list":"project.tab";const value=list?outcome.value:args[1];
            if(list){const parsed=JSON.parse(value);assert.equal(parsed.version,1);assert.match(parsed.revision,/^[0-9a-f-]{36}$/i);}
            preferences.set(`${profile.id}/${key}`,{userId:profile.id,key,value});
          }
          await persist();
          if(loseResponse){record.phase="response-lost-after-upstream-commit";record.delivery={...record.delivery,abortStartedAt:new Date().toISOString()};await persist();await route.abort("failed");record.delivery={...record.delivery,abortedAt:new Date().toISOString()};await persist();return;}
          if(delayed){delayed.captured=true;await delayed.gate;}
          if(closed){record.delivery={...record.delivery,fulfillStartedAt:new Date().toISOString()};await persist();}
          await route.fulfill({response,body});
          if(closed){record.delivery={...record.delivery,fulfilledAt:new Date().toISOString()};await persist();}
        })();pending.add(task);try{await task;}catch{receipt.failures.push(`ACTION_CAPTURE_FAILED:${name}`);await route.abort("blockedbyclient").catch(()=>{});}finally{pending.delete(task);}return;
      }
      if(!closing)receipt.failures.push(`UNAUTHORIZED_MUTATION_BLOCKED:${name}:${url.pathname}`);
      await route.abort("blockedbyclient");
    });
    const current=await context.newPage();
    for(const event of ["requestfinished","requestfailed"]){
      current.on(event,request=>{
        const record=deliveryRequests.get(request);if(!record)return;
        // Диагностика только известного UUID: без URL, headers и текста сетевой ошибки.
        record.delivery={...record.delivery,[event]:{at:new Date().toISOString(),clientMutationId:record.request.clientMutationId}};
        void persist().catch(()=>{});
      });
    }
    const network=[];current.on("request",request=>{
      const url=new URL(request.url());const prefetch=request.headers()["next-router-prefetch"]||request.headers()["purpose"]==="prefetch";
      if(!prefetch&&request.method()==="GET"&&url.pathname===path&&(request.isNavigationRequest()||request.headers()["rsc"]||url.searchParams.has("_rsc")))network.push({path:url.pathname,kind:request.isNavigationRequest()?"document":"RSC"});
      if(/nbrb|exrates/i.test(url.hostname+url.pathname))receipt.failures.push("UNEXPECTED_CLIENT_FX_REQUEST");
    });
    current.on("pageerror",error=>{
      const redact=value=>String(value??"").replace(/Bearer\s+[A-Za-z0-9._-]+/gi,"Bearer [REDACTED_SECRET]").replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,"[REDACTED_SECRET]");
      receipt.pageErrors.push({profile:name,phase,name:error.name,message:redact(error.message).slice(0,1500),stack:redact(error.stack).slice(0,4000)});
      receipt.failures.push(`PAGE_ERROR:${name}`);
      void writeFile(resolve(outputDir,"project-inline-page-errors.json"),JSON.stringify(receipt.pageErrors,null,2),{mode:0o600}).catch(()=>{});
    });
    current.on("response",response=>{if(response.status()>=400&&!(expectedDenial&&new URL(response.url()).pathname===path&&[403,404].includes(response.status())))receipt.failures.push(`HTTP_ERROR:${name}:${response.status()}:${new URL(response.url()).pathname}`);});
    contexts.set(name,{context,page:current,network,close:async()=>{closing=true;await context.close();}});return contexts.get(name);
  }
  const field=(p,id)=>p.locator(`#project-inline-${id}`);
  const state=(p,id)=>p.locator(`#project-inline-${id}-state`);
  async function goto(p,path){const response=await p.goto(`${origin}${path}`,{waitUntil:"networkidle"});assert.equal(response.status(),200,"PRODUCT_HTTP_FAILED");assert.equal(new URL(p.url()).pathname,path,"PRODUCT_SESSION_OR_ACCESS_FAILED");await field(p,"title").waitFor();}
  async function saved(p,id){await expect(state(p,id).getByText("Сохранено",{exact:true})).toBeVisible({timeout:15000});}
  async function enter(p,id,value){await field(p,id).fill(value);await field(p,id).press("Enter");await saved(p,id);}
  const patches=()=>receipt.requests.filter(request=>request.type==="patch");
  async function selectClient(p,label){await field(p,"client").click();await p.getByRole("button").filter({has:p.getByText(label,{exact:true})}).click();await saved(p,"client");}
  async function geometry(p,label){const measured=await p.evaluate(()=>({width:innerWidth,body:document.body.scrollWidth,html:document.documentElement.scrollWidth}));assert.ok(Math.max(measured.body,measured.html)<=measured.width+1,"PAGE_HORIZONTAL_OVERFLOW");check(label,measured);}
  async function screenshot(p,label){const path=resolve(outputDir,`${label}.png`);await p.screenshot({path,fullPage:true});receipt.screenshots.push({label,path});}
  try {
    const admin=await startContext("admin",profiles.admin);page=admin.page;
    const secondProfile=profiles.manager??profiles.combined??profiles.admin;const second=await startContext("second-editor",secondProfile);
    await goto(page,path);await goto(second.page,path);
    phase="layout_and_single_patch";
    const tabs=(await page.getByRole("tab").allTextContents()).map(text=>text.replace(/\s*\(\d+\)$/,""));assert.deepEqual(tabs.slice(0,6),["Общее","Изделия","Файлы","Задачи","Материалы","Финансы"]);
    assert.equal(await page.getByRole("tab",{name:/Коммуникации|История/}).count(),0);assert.equal(await page.getByText(/Первоначальная цена/).count(),0);
    assert.ok(await page.getByText("Инженеры назначенные в Изделиях",{exact:true}).isVisible());
    const count=patches().length,nav=admin.network.length;await field(page,"title").fill("QA18 direct title");await field(page,"title").press("Enter");await field(page,"title").press("Tab");await saved(page,"title");assert.equal(patches().length-count,1);assert.equal(admin.network.length,nav);const none=patches().length;await field(page,"title").press("Enter");await saved(page,"title");assert.equal(patches().length,none);check("ordered tabs/title/status/ghost engineers, no initialPrice/history/communications; one compact patch/no-op/no RSC");
    phase="independent_queue_and_conflict";
    let release;const hold={field:"title",captured:false,gate:new Promise(done=>{release=done;})};releases.push(()=>release());delayPlan=hold;
    await field(page,"title").fill("QA18 held title");await field(page,"title").press("Enter");await expect.poll(()=>hold.captured).toBe(true);await field(page,"title").fill("QA18 newer draft");await new Promise(done=>setTimeout(done,750));release();await expect(field(page,"title")).toHaveValue("QA18 newer draft");await field(page,"title").press("Enter");await saved(page,"title");
    await goto(page,path);await goto(second.page,path);await field(second.page,"title").fill("QA18 challenger");await enter(page,"title","QA18 winner");await field(second.page,"title").press("Enter");await expect(state(second.page,"title").getByRole("button",{name:"Сохранить мой ввод"})).toBeVisible();await expect(field(second.page,"title")).toHaveValue("QA18 challenger");await state(second.page,"title").getByRole("button",{name:"Сохранить мой ввод"}).click();await saved(second.page,"title");check("slow ACK preserves new draft and two-user CAS requires explicit rebase");
    phase="services_precision_null_zero_lost_ack";
    await goto(page,path);await enter(page,"delivery","0.10");await enter(page,"unloading","0.20");assert.equal(patches().at(-1).result.derived.expectedTotalBYN,"20.32");
    await field(page,"installation").fill("1.001");await field(page,"installation").press("Enter");await expect(state(page,"installation").getByRole("alert")).toBeVisible();await enter(page,"installation","0");assert.equal(patches().at(-1).result.value,"0.00");await enter(page,"installation","");assert.equal(patches().at(-1).result.value,null);
    abortField="address";await field(page,"address").fill("QA18 lost ACK address");await field(page,"address").press("Enter");await expect(state(page,"address").getByRole("alert")).toBeVisible();const lost=patches().at(-1);assert.equal(lost.phase,"response-lost-after-upstream-commit");await state(page,"address").getByRole("button",{name:"Повторить сохранение"}).click();await saved(page,"address");assert.equal(patches().at(-1).request.clientMutationId,lost.request.clientMutationId);assert.equal(patches().at(-1).result.repeated,true);check("confirmed decimal total/zero/null and same-ID lost-response replay");
    phase="shared_phone_client";
    await goto(page,path);await goto(second.page,path);await field(page,"phone").fill("777");await selectClient(second.page,fixture.initial.clientLabelB);await field(page,"phone").press("Enter");await expect(state(page,"phone").getByText(/Клиент проекта изменён/)).toBeVisible();await expect(field(page,"phone")).toHaveValue("777");await state(page,"phone").getByRole("button",{name:"Принять сохранённое"}).click();await expect(field(page,"phone")).toHaveValue(fixture.initial.phoneB);await enter(page,"phone","888");assert.equal(patches().at(-1).request.expectedClientId,fixture.ids.clientB);await selectClient(page,fixture.initial.clientLabelA);await expect(field(page,"phone")).toHaveValue(fixture.initial.phoneA);check("required phone explicit client-binding conflict and original-client phone retained");
    phase="stage_extras";statusPermit=true;
    await page.getByLabel("Статус",{exact:true}).click();await page.getByRole("option",{name:"Отказ",exact:true}).click();let dialog=page.getByRole("dialog");await dialog.getByRole("button",{name:"Перевести в «Отказ»"}).click();await expect(dialog.getByRole("alert")).toBeVisible();const invalid=receipt.requests.filter(record=>record.type==="status").at(-1);assert.equal(invalid.result.ok,false);await dialog.locator("#refusalReason").fill("QA18 reason");await dialog.getByRole("button",{name:"Отмена",exact:true}).click();assert.equal(await page.getByRole("dialog").count(),0);
    await page.getByLabel("Статус",{exact:true}).click();await page.getByRole("option",{name:"Отказ",exact:true}).click();dialog=page.getByRole("dialog");await expect(dialog.locator("#refusalReason")).toHaveValue("QA18 reason");await dialog.getByRole("button",{name:"Перевести в «Отказ»"}).click();await expect(page.getByLabel("Статус",{exact:true})).toContainText("Отказ");assert.equal(receipt.requests.filter(record=>record.type==="status").at(-1).result.ok,true);
    await page.getByLabel("Статус",{exact:true}).click();await page.getByRole("option",{name:"Лид",exact:true}).click();await expect(page.getByLabel("Статус",{exact:true})).toContainText("Лид");
    await page.getByLabel("Статус",{exact:true}).click();await page.getByRole("option",{name:"Рекламация",exact:true}).click();dialog=page.getByRole("dialog");await dialog.locator("#reclamationReason").fill("QA18 reclaim");await dialog.locator("#reclamationDescription").fill("QA18 description");await dialog.locator("#reclamationFault").fill("QA18 company");await dialog.getByRole("button",{name:"Открыть рекламацию",exact:true}).click();await expect(page.getByLabel("Статус",{exact:true})).toContainText("Рекламация");statusPermit=false;check("stage validates extras before writes, cancel retains reason, refusal comment optional; no product transitions");
    phase="flat_pdf_append_and_draft_survival";
    substep="hold_title_then_files";
    const draft="QA18 dirty title survives PDFs";
    // Переход к вкладке вызывает blur: создаём более новый черновик во время
    // задержанного подтверждения, затем files refresh обязан сохранить его.
    await goto(page,path);let releaseFileDraft;const fileHold={field:"title",captured:false,gate:new Promise(done=>{releaseFileDraft=done;})};releases.push(()=>releaseFileDraft());delayPlan=fileHold;await field(page,"title").fill("QA18 prior title ACK");await field(page,"title").press("Enter");await expect.poll(()=>fileHold.captured).toBe(true);await field(page,"title").fill(draft);await page.getByRole("tab",{name:/^Файлы/}).click();
    const flat=page.locator('[data-project-files="flat"]');await flat.waitFor();await flat.locator('[data-slot="select-trigger"]').click();await page.getByRole("option",{name:"Прочее",exact:true}).click();
    const pdf=(text)=>{const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];const stream=`BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);let data='%PDF-1.4\n',offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(data));data+=`${index+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(data);data+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(data);};
    substep="upload_two_owned_pdfs";
    for(const index of [1,2]){await page.getByRole("tab",{name:/^Файлы/}).click();await page.locator('[data-project-files="flat"] [data-slot="select-trigger"]').click();await page.getByRole("option",{name:"Прочее",exact:true}).click();const bytes=pdf(`QA18 file ${index}`);await flat.locator('input[type="file"]').setInputFiles({name:`qa18-${fixture.ids.project}-${index}.pdf`,mimeType:"application/pdf",buffer:bytes});await expect.poll(()=>uploadedFileIds.size).toBe(index);await page.getByRole("tab",{name:/^Файлы/}).click();await expect(page.locator('[data-project-files="flat"]').getByText(`qa18-${fixture.ids.project}-${index}.pdf`,{exact:true})).toBeVisible();}
    substep="upload_owned_png";
    const imageName=`qa18-${fixture.ids.project}-3.png`;
    const png=await sharp({create:{width:8,height:8,channels:4,background:{r:40,g:120,b:200,alpha:1}}}).png().toBuffer();
    await page.getByRole("tab",{name:/^Файлы/}).click();await page.locator('[data-project-files="flat"] [data-slot="select-trigger"]').click();await page.getByRole("option",{name:"Фото",exact:true}).click();
    await page.locator('[data-project-files="flat"] input[type="file"]').setInputFiles({name:imageName,mimeType:"image/png",buffer:png});
    await expect.poll(()=>uploadedFileIds.size).toBe(3);await page.getByRole("tab",{name:/^Файлы/}).click();await expect(page.locator('[data-project-files="flat"]').getByText(imageName,{exact:true})).toBeVisible();
    const imageId=receipt.requests.filter(record=>record.type==="file-upload"&&record.fileName===imageName).at(-1).result.id;
    substep="sign_all_live_file_keys";
    assert.ok(onOwnFiles,"ROOT_FILE_SIGNING_CALLBACK_REQUIRED_BEFORE_DELETE");await onOwnFiles({uploadedFileIds:[...uploadedFileIds]});
    substep="release_ack_and_check_title";
    releaseFileDraft();await page.getByRole("tab",{name:"Общее",exact:true}).click();await expect(field(page,"title")).toHaveValue(draft);await saved(page,"title");
    substep="read_original_pdf_bytes";
    for(const id of [...uploadedFileIds].slice(0,2)){const response=await admin.context.request.get(`${origin}/api/files/${id}`);assert.equal(response.status(),200);assert.ok(response.headers()["content-type"].includes("application/pdf"));assert.ok((await response.body()).subarray(0,8).toString().startsWith("%PDF"));}
    substep="original_png_and_full_image_dialog";
    const imageOriginal=await admin.context.request.get(`${origin}/api/files/${imageId}`);assert.equal(imageOriginal.status(),200);assert.ok(imageOriginal.headers()["content-type"].includes("image/png"));assert.deepEqual(await imageOriginal.body(),png);
    await page.getByRole("tab",{name:/^Файлы/}).click();await page.locator('[data-project-files="flat"]').getByText(imageName,{exact:true}).click();
    const imageDialog=page.getByRole("dialog",{name:imageName,exact:true});await imageDialog.waitFor();const fullImage=imageDialog.getByRole("img",{name:imageName,exact:true});await expect(fullImage).toBeVisible();
    await expect.poll(()=>fullImage.evaluate(image=>image.complete&&image.naturalWidth===8&&image.naturalHeight===8)).toBe(true);
    await screenshot(page,"owned-flat-image-full-view");await imageDialog.getByRole("button",{name:"Закрыть",exact:true}).click();await expect(imageDialog).toBeHidden();
    check("flat PNG row opens actual loaded full-size FileViewer image; original PNG bytes unchanged");
    substep="open_pdf_popup";
    await page.getByRole("tab",{name:/^Файлы/}).click();const originalName=`qa18-${fixture.ids.project}-1.pdf`;const popupPromise=admin.context.waitForEvent("page");await page.locator('[data-project-files="flat"]').getByText(originalName,{exact:true}).click();const popup=await popupPromise;await popup.waitForURL(/\/api\/files\/[^/?]+\?view=1/,{waitUntil:"commit"});assert.ok(popup.url().includes("view=1"));const preview=await admin.context.request.get(popup.url());assert.equal(preview.status(),200);assert.match(preview.headers()["content-disposition"],/^inline/);assert.ok(preview.headers()["content-type"].includes("application/pdf"));receipt.checks.push({label:"PDF UI requests explicit inline original in a new tab",passed:true,visualRendering:"native PDF plugin layout not inspected by this assertion"});await popup.close();
    substep="delete_exact_first_pdf";
    deletePermit=[...uploadedFileIds][0];await page.locator('[data-project-files="flat"] [data-slot="card"]').filter({has:page.getByText(originalName,{exact:true})}).getByRole("button",{name:"Удалить",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:"Удалить",exact:true}).click();await expect(page.getByText(originalName,{exact:true})).toHaveCount(0);deletePermit=null;assert.equal(uploadedFileIds.size,3);check("two independent PDFs appended, originals open, precise delete, dirty field preserved through files RSC");
    phase="compiled_api_same_contract";
    if(apiProbe){
      await page.getByRole("tab",{name:"Общее",exact:true}).click();
      const input={projectId:ownedProject,field:"title",value:"QA18 compiled API title",expectedValue:await field(page,"title").inputValue(),clientMutationId:crypto.randomUUID()};
      const proof=await apiProbe(input);
      assert.equal(proof.status,200,"COMPILED_API_HTTP_FAILED");assert.equal(proof.result?.kind,"saved","COMPILED_API_PATCH_NOT_SAVED");assert.equal(proof.result.clientMutationId,input.clientMutationId,"COMPILED_API_MUTATION_NOT_CAPTURED");
      receipt.requests.push({type:"api-patch",actorId:proof.actorId??profiles.admin.id,request:input,result:proof.result,httpStatus:proof.status,phase:"response-captured"});
      own.set(input.clientMutationId,{actorId:proof.actorId??profiles.admin.id,projectId:ownedProject,field:input.field,value:proof.result.value,clientMutationId:input.clientMutationId,auditLookupKey:`project-inline:${input.clientMutationId}`,source:"telegram"});
      await persist();check("compiled authenticated API uses same closed ProjectPatch receipt and genuine baseline");
    }else receipt.skips.push("compiled API root callback unavailable; API acceptance not claimed");
    phase="roles_and_geometry";
    for(const [name,profile]of Object.entries(profiles)){
      assert.match(name,/^[a-zA-Z0-9_-]+$/,"SAFE_PROFILE_LABEL_REQUIRED");
      if(!profile?.cookies?.length){receipt.skips.push(`${name}: no session`);continue;}
      const current=name==="admin"?admin:await startContext(`role-${name}`,profile);page=current.page;activeProfile=name;const response=await page.goto(`${origin}${path}`,{waitUntil:"networkidle"});
      if([403,404].includes(response.status())){assert.ok(profile.roles.every(role=>["WORKER","MOUNTER"].includes(role)),"OFFICE_PROJECT_ACCESS_UNEXPECTEDLY_DENIED");assert.equal(await field(page,"title").count(),0);check(`${name}: scoped DESIGN project denied without inline field disclosure`,{httpStatus:response.status()});continue;}
      assert.equal(response.status(),200);const manage=profile.roles.some(role=>["ADMIN","DIRECTOR","MANAGER"].includes(role));assert.equal(await field(page,"title").getAttribute("readonly")!==null,!manage);assert.equal(await field(page,"phone").getAttribute("readonly")!==null,!manage);
      for(const[width,height]of VIEWPORTS){await page.setViewportSize({width,height});await geometry(page,`${name}-${width}x${height}`);await screenshot(page,`${name}-${width}x${height}`);}
    }
    phase="sidebar_smooth_and_native_sw";page=admin.page;activeProfile="admin";await goto(page,path);
    for(const width of [320,360,390,768,1024,1440]){
      await page.setViewportSize({width,height:900});await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
      const trigger=page.getByLabel("Открыть меню",{exact:true});
      if(width<768){await trigger.click();await page.locator('[data-mobile="true"][data-slot="sidebar"]').waitFor();await geometry(page,`sidebar-open-${width}`);await screenshot(page,`sidebar-open-${width}`);await page.keyboard.press("Escape");await page.locator('[data-mobile="true"][data-slot="sidebar"]').waitFor({state:"hidden"});await geometry(page,`sidebar-closed-${width}`);}
      else{const sidebar=page.locator('[data-slot="sidebar"][data-state]');if(await sidebar.getAttribute("data-state")!=="expanded")await trigger.click();await geometry(page,`sidebar-expanded-${width}`);await trigger.click();await expect(sidebar).toHaveAttribute("data-state","collapsed");await geometry(page,`sidebar-collapsed-${width}`);}
    }
    for(let width=320;width<=1440;width+=40){await page.setViewportSize({width,height:900});await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));await geometry(page,`smooth-${width}`);}
    receipt.serviceWorker=await page.evaluate(async()=>({controller:navigator.serviceWorker.controller?.scriptURL??null,registrations:(await navigator.serviceWorker.getRegistrations()).map(registration=>({scope:registration.scope,active:registration.active?.scriptURL??null}))}));
    assert.ok(receipt.serviceWorker.registrations.some(registration=>registration.active),"NATIVE_SERVICE_WORKER_NOT_REGISTERED");
    await Promise.allSettled([...pending]);await persist();receipt.uploadedFileIds=[...uploadedFileIds];receipt.status=receipt.failures.length?"FAIL":"PASS";receipt.passed=receipt.status==="PASS";
  }catch(error){receipt.failures.push({code:"PROJECT_INLINE_BROWSER_STOP",phase,substep,errorType:error?.name??"Error"});
    const redact=value=>String(value??"").replace(/(?:authorization|proxy-authorization|cookie|set-cookie)\s*:[^\r\n]*/gi,"[REDACTED_SECRET]").replace(/Bearer\s+[A-Za-z0-9._-]+/gi,"Bearer [REDACTED_SECRET]").replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,"[REDACTED_SECRET]").replace(/[a-z][a-z0-9+.-]*:\/\/[^\s/]+@[^\s/]+/gi,"[REDACTED_URL]");
    await writeFile(resolve(outputDir,"project-inline-failure-detail.json"),JSON.stringify({phase,substep,errorType:error?.name??"Error",failureMessage:redact(error?.message).slice(0,4000)},null,2),{mode:0o600}).catch(()=>{});if(page&&!page.isClosed()){await screenshot(page,`${activeProfile}-failure`).catch(()=>{});await writeFile(resolve(outputDir,"project-inline-failure-dom.txt"),await page.locator("body").innerText().catch(()=>"DOM_UNAVAILABLE"),{mode:0o600}).catch(()=>{});}}
  finally{for(const release of releases)release();await Promise.allSettled([...pending]);for(const item of contexts.values())await item.close().catch(()=>{});await browser.close();await persist();receipt.uploadedFileIds=[...uploadedFileIds];await writeFile(resolve(outputDir,"project-inline-browser-receipt.json"),JSON.stringify(receipt,null,2),{mode:0o600});}
  return receipt;
}
export default runProjectInlineBrowser;
