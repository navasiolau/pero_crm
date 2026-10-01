// Actual Chromium tab zoom, isolated from personal browser profiles.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, realpath, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve, relative, isAbsolute } from "node:path";
import { chromium } from "@playwright/test";

const PREFIX="pero-crm-browser-zoom-";
export async function runCrmBrowserZoom({origin,profile,basicAuth,outputDir}) {
  assert.ok(["http://127.0.0.1:3016","https://staging-crm.peromebel.by"].includes(origin),"ZOOM_ORIGIN_MISMATCH_STOP");
  assert.ok(Array.isArray(profile?.cookies)&&profile.cookies.length,"SHORT_LIVED_ADMIN_SESSION_REQUIRED");
  assert.ok(profile.roles?.includes("ADMIN"),"ADMIN_PROFILE_REQUIRED");
  assert.ok(outputDir,"OUTPUT_DIRECTORY_REQUIRED");
  const temporaryRoot=await realpath(tmpdir());
  const owned=await mkdtemp(resolve(temporaryRoot,PREFIX));
  const ownedCanonical=await realpath(owned);
  const output=resolve(outputDir);
  const outputRelative=relative(ownedCanonical,output);
  assert.ok(outputRelative.startsWith("..")||isAbsolute(outputRelative),"OUTPUT_INSIDE_SECRET_TEMP_PROFILE_FORBIDDEN");
  const receipt={kind:"crm-browser-actual-zoom",origin,zoomMode:"chrome.tabs.setZoom/getZoom; actual browser tab zoom",status:"FAIL",passed:false,checks:[],screenshots:[],temporaryProfileRemoved:false};
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
        // Source-verified NotificationsBell zero-argument read is incidental.
        let args;try{args=JSON.parse(request.postData()??"");}catch{}
        const url=new URL(request.url());
        if(request.method()==="POST"&&url.origin===origin&&url.pathname==="/settings/payroll"&&request.headers()["next-action"]&&Array.isArray(args)&&args.length===0){
          bellActionId??=request.headers()["next-action"];
          if(request.headers()["next-action"]===bellActionId){await route.continue();return;}
        }
        receipt.checks.push({label:"unknown mutating request blocked",passed:false});await route.abort("blockedbyclient");return;
      }
      await route.continue();
    });
    worker=context.serviceWorkers()[0]??await context.waitForEvent("serviceworker",{timeout:15000});
    page=context.pages()[0]??await context.newPage();
    phase="payroll_settings_navigation";
    const response=await page.goto(`${origin}/settings/payroll`,{waitUntil:"networkidle"});
    assert.ok(response&&response.status()===200,"SETTINGS_REQUEST_FAILED");
    assert.equal(new URL(page.url()).pathname,"/settings/payroll","SESSION_NOT_ACCEPTED");
    await page.getByText("BYN — белорусский рубль",{exact:true}).waitFor();
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
    const after=await geometry();
    assert.ok(Math.abs(after.innerWidth-before.innerWidth/2)<=2,"ACTUAL_ZOOM_CSS_WIDTH_NOT_HALVED");
    assert.ok(Math.abs(after.dpr-before.dpr*2)<0.01,"ACTUAL_ZOOM_DPR_NOT_DOUBLED");
    assert.ok(["1","normal"].includes(after.cssZoom),"CSS_ZOOM_WAS_NOT_USED");
    const fits=Math.max(after.bodyWidth,after.htmlWidth)<=after.innerWidth+1;
    receipt.checks.push({label:"actual browser tab zoom200",passed:true,zoom,before,after});
    receipt.checks.push({label:"payroll settings no horizontal overflow at actual200",passed:fits});
    const screenshot=resolve(output,"crm-byn-actual-browser-zoom200.png");
    await page.screenshot({path:screenshot,fullPage:true});receipt.screenshots.push(screenshot);
    phase="reset_zoom";
    const reset=await worker.evaluate(async id=>{await chrome.tabs.setZoom(id,1);return chrome.tabs.getZoom(id);},tabId);
    assert.equal(reset,1,"ZOOM_RESET_FAILED");
    receipt.status=receipt.checks.every(check=>check.passed)?"PASS":"FAIL";receipt.passed=receipt.status==="PASS";
  }catch(error){receipt.failure={code:"ACTUAL_BROWSER_ZOOM_PROBE_STOP",phase,errorType:error?.name??"Error"};}
  finally {
    if(context){if(worker&&tabId)await worker.evaluate(async id=>{await chrome.tabs.setZoom(id,1);},tabId).catch(()=>{});await context.close();}
    // Exact mkdtemp directory only; canonical containment/reparse guard before rm.
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
