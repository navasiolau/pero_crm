// Настоящий Chromium tab zoom в отдельном временном профиле.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, realpath, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve, relative, isAbsolute } from "node:path";
import { chromium } from "@playwright/test";

const PREFIX="pero-crm-browser-zoom-";
export async function runCrmBrowserZoom({origin,profile,basicAuth,outputDir,pagePath="/settings/payroll",ownedProductPaths=[],readySelector,ownedProjectPaths=[]}) {
  assert.ok(["http://127.0.0.1:3016","http://127.0.0.1:3017","http://127.0.0.1:3018","https://staging-crm.peromebel.by"].includes(origin),"ZOOM_ORIGIN_MISMATCH_STOP");
  assert.ok(pagePath==="/settings/payroll" || (/^\/products\/[^/]+$/.test(pagePath)&&ownedProductPaths.includes(pagePath)) || (/^\/projects\/[^/]+$/.test(pagePath)&&ownedProjectPaths.includes(pagePath)),"ZOOM_PATH_NOT_OWNED_STOP");
  if(pagePath!=="/settings/payroll")assert.equal(readySelector,pagePath.startsWith("/projects/")?"#project-inline-title":"#product-inline-title","OWNED_INLINE_READY_SELECTOR_REQUIRED");
  assert.ok(Array.isArray(profile?.cookies)&&profile.cookies.length,"SHORT_LIVED_ADMIN_SESSION_REQUIRED");
  assert.ok(profile.roles?.includes("ADMIN"),"ADMIN_PROFILE_REQUIRED");
  assert.ok(outputDir,"OUTPUT_DIRECTORY_REQUIRED");
  const temporaryRoot=await realpath(tmpdir());
  const owned=await mkdtemp(resolve(temporaryRoot,PREFIX));
  const ownedCanonical=await realpath(owned);
  const output=resolve(outputDir);
  const outputRelative=relative(ownedCanonical,output);
  assert.ok(outputRelative.startsWith("..")||isAbsolute(outputRelative),"OUTPUT_INSIDE_SECRET_TEMP_PROFILE_FORBIDDEN");
  const receipt={kind:"crm-browser-actual-zoom",origin,pagePath,zoomMode:"chrome.tabs.setZoom/getZoom; actual browser tab zoom",status:"FAIL",passed:false,checks:[],screenshots:[],captures:[],temporaryProfileRemoved:false};
  let context;
  let page;
  let worker;
  let tabId;
  let bellActionId;
  let phase="isolated_extension_setup";
  try {
    const extension=resolve(ownedCanonical,"extension");
    const profileDir=resolve(ownedCanonical,"profile");
    await mkdir(extension);await mkdir(profileDir);await mkdir(output,{recursive:true});
    await writeFile(resolve(extension,"manifest.json"),JSON.stringify({manifest_version:3,name:"PERO isolated QA tab zoom",version:"1.0",permissions:["tabs"],background:{service_worker:"worker.js"}}));
    await writeFile(resolve(extension,"worker.js"),"chrome.runtime.onInstalled.addListener(() => {});\n");
    phase="chromium_extension_launch";
    context=await chromium.launchPersistentContext(profileDir,{channel:"chromium",headless:true,viewport:null,serviceWorkers:"allow",httpCredentials:basicAuth,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,"--window-size=1440,900"]});
    await context.addCookies(profile.cookies);
    await context.route("**/*",async route=>{
      const request=route.request();
      if(!["GET","HEAD","OPTIONS"].includes(request.method())) {
        // По исходникам единственный вызов без аргументов здесь — чтение NotificationsBell.
        let args;try{args=JSON.parse(request.postData()??"");}catch{}
        const url=new URL(request.url());
        if(request.method()==="POST"&&url.origin===origin&&url.pathname===pagePath&&request.headers()["next-action"]&&Array.isArray(args)&&args.length===0){
          bellActionId??=request.headers()["next-action"];
          if(request.headers()["next-action"]===bellActionId){await route.continue();return;}
        }
        receipt.checks.push({label:"unknown mutating request blocked",passed:false});await route.abort("blockedbyclient");return;
      }
      await route.continue();
    });
    worker=context.serviceWorkers()[0]??await context.waitForEvent("serviceworker",{timeout:15000});
    page=context.pages()[0]??await context.newPage();
    phase=pagePath==="/settings/payroll"?"payroll_settings_navigation":"owned_inline_navigation";
    const response=await page.goto(`${origin}${pagePath}`,{waitUntil:"networkidle"});
    assert.ok(response&&response.status()===200,"SETTINGS_REQUEST_FAILED");
    assert.equal(new URL(page.url()).pathname,pagePath,"SESSION_NOT_ACCEPTED");
    if(pagePath==="/settings/payroll")await page.getByText("BYN — белорусский рубль",{exact:true}).waitFor();
    else await page.locator(readySelector).waitFor();
    tabId=await worker.evaluate(async url=>{
      const tabs=await chrome.tabs.query({});
      const matches=tabs.filter(tab=>tab.url===url);
      if(matches.length!==1)throw new Error("EXACT_QA_TAB_REQUIRED");
      return matches[0].id;
    },page.url());
    const geometry=()=>page.evaluate(()=>({innerWidth,innerHeight,dpr:devicePixelRatio,bodyWidth:document.body.scrollWidth,htmlWidth:document.documentElement.scrollWidth,cssZoom:getComputedStyle(document.documentElement).zoom}));
    const before=await geometry();
    phase="actual_browser_zoom_200";
    const zoom=await worker.evaluate(async id=>{await chrome.tabs.setZoom(id,2);return chrome.tabs.getZoom(id);},tabId);
    assert.equal(zoom,2,"ACTUAL_TAB_ZOOM_NOT_200");
    await page.waitForFunction(previous=>innerWidth<previous.innerWidth&&devicePixelRatio>previous.dpr,before,{timeout:10000});
    let quantityDraft;
    let invalidSelector;
    let invalidMessage;
    if(pagePath!=="/settings/payroll") {
      invalidSelector=pagePath.startsWith("/projects/")?"#project-inline-delivery":"#product-inline-quantity";
      invalidMessage=pagePath.startsWith("/projects/")?/^Введите неотрицательную/:/^Количество/;
      const quantity=page.locator(invalidSelector);
      quantityDraft=await quantity.inputValue();
      await quantity.fill(pagePath.startsWith("/projects/")?"1.001":"0");await quantity.press("Enter");
      const error=page.locator(`${invalidSelector}-state [role="alert"]`);await error.waitFor();
      assert.match(await error.innerText(),invalidMessage,"LOCAL_QUANTITY_VALIDATION_NOT_SHOWN");
      receipt.checks.push({label:"local scalar validation error displayed at actual browser200 without field POST",passed:true});
    }
    const after=await geometry();
    assert.ok(Math.abs(after.innerWidth-before.innerWidth/2)<=2,"ACTUAL_ZOOM_CSS_WIDTH_NOT_HALVED");
    assert.ok(Math.abs(after.dpr-before.dpr*2)<0.01,"ACTUAL_ZOOM_DPR_NOT_DOUBLED");
    assert.ok(["1","normal"].includes(after.cssZoom),"CSS_ZOOM_WAS_NOT_USED");
    const fits=Math.max(after.bodyWidth,after.htmlWidth)<=after.innerWidth+1;
    receipt.checks.push({label:"actual browser tab zoom200",passed:true,zoom,before,after});
    receipt.checks.push({label:`${pagePath} no horizontal overflow at actual200`,passed:fits});
    // Playwright 1.63 вычисляет screenshot clip из CSS innerWidth; при настоящем
    // tab zoom это может обрезать правую половину физического viewport.
    // Нативный CDP capture без clip/metrics override сохраняет видимый compositor.
    const screenshotSession=await context.newCDPSession(page);
    async function captureViewport(fileName,label) {
      await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
      const initial=await geometry();
      const metrics=await screenshotSession.send("Page.getLayoutMetrics");
      const captured=await screenshotSession.send("Page.captureScreenshot",{format:"png",fromSurface:true,captureBeyondViewport:false});
      const bytes=Buffer.from(captured.data,"base64");
      assert.equal(bytes.subarray(0,8).toString("hex"),"89504e470d0a1a0a","VIEWPORT_CAPTURE_NOT_PNG");
      const pixels={width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
      const current=await geometry();
      assert.deepEqual(current,initial,"VIEWPORT_CAPTURE_DISTORTED_GEOMETRY");
      assert.equal(await worker.evaluate(id=>chrome.tabs.getZoom(id),tabId),2,"VIEWPORT_CAPTURE_CHANGED_ACTUAL_ZOOM");
      const physicalWidth=Math.round(initial.innerWidth*initial.dpr);
      assert.ok(pixels.width>=physicalWidth-2&&pixels.width<=physicalWidth+32,"VIEWPORT_CAPTURE_WIDTH_NOT_PHYSICAL");
      const path=resolve(output,fileName);await writeFile(path,bytes);receipt.screenshots.push(path);
      receipt.captures.push({label,path,pixels,before:initial,after:current,cssViewport:metrics.cssVisualViewport,physicalViewport:metrics.visualViewport,mode:"native viewport compositor; no CSS clip or emulation"});
      receipt.checks.push({label:`${label}: faithful viewport, actual zoom2 and unchanged geometry`,passed:true});
    }
    try {
      await page.evaluate(()=>window.scrollTo({top:0,left:0,behavior:"instant"}));
      await captureViewport("crm-byn-actual-browser-zoom200.png","zoom200-top");
      if(quantityDraft!==undefined){
        await page.locator(`${invalidSelector}-state [role="alert"]`).scrollIntoViewIfNeeded();
        await captureViewport("crm-byn-actual-browser-zoom200-quantity-error.png","zoom200-quantity-error");
      }
    }finally{await screenshotSession.detach();}
    if(quantityDraft!==undefined)await page.locator(invalidSelector).fill(quantityDraft);
    phase="reset_zoom";
    const reset=await worker.evaluate(async id=>{await chrome.tabs.setZoom(id,1);return chrome.tabs.getZoom(id);},tabId);
    assert.equal(reset,1,"ZOOM_RESET_FAILED");
    receipt.status=receipt.checks.every(check=>check.passed)?"PASS":"FAIL";receipt.passed=receipt.status==="PASS";
  }catch(error){receipt.failure={code:"ACTUAL_BROWSER_ZOOM_PROBE_STOP",phase,errorType:error?.name??"Error"};}
  finally {
    if(context){if(worker&&tabId)await worker.evaluate(async id=>{await chrome.tabs.setZoom(id,1);},tabId).catch(()=>{});await context.close();}
    // Удаляем только собственный mkdtemp после проверок пути и reparse guard.
    const current=await realpath(owned);
    const stats=await lstat(owned);
    assert.equal(current,ownedCanonical,"OWNED_TEMP_PATH_CHANGED_STOP");
    assert.equal(dirname(current),temporaryRoot,"OWNED_TEMP_OUTSIDE_ROOT_STOP");
    assert.ok(basename(current).startsWith(PREFIX)&&!stats.isSymbolicLink(),"OWNED_TEMP_REPARSE_MISMATCH_STOP");
    await rm(current,{recursive:true,force:false});receipt.temporaryProfileRemoved=true;
    await writeFile(resolve(output,"crm-browser-zoom-receipt.json"),JSON.stringify(receipt,null,2));
  }
  return receipt;
}
export default runCrmBrowserZoom;
