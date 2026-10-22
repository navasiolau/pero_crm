import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const web = process.cwd(), require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const mode = process.argv[2] ?? "both";
assert.ok(["both", "products"].includes(mode), "KANBAN_QA_SECTION_REQUIRED");
const sections = mode === "products" ? ["products"] : ["projects", "products"];
const directory = process.env.KANBAN_FOCUS_ARTIFACT_DIR
  ? path.resolve(web, process.env.KANBAN_FOCUS_ARTIFACT_DIR)
  : path.resolve(web, "../../.playwright-mcp", mode === "products" ? "search145/components" : "search117");
await mkdir(directory, { recursive: true });
// Настоящие Views, карточки, DnD, фильтры, контроллер и Sheet. Только
// Next-навигация и серверные actions заменены контролируемым транспортом.
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {ProjectsView} from '@/app/(app)/projects/projects-view';
import {ProductsView} from '@/app/(app)/products/products-view';
import {ListParamsProvider,useListParams} from '@/lib/list-params';
import {parseListFilterValue} from '@/lib/list-filter-values';
import {normalizeListQuery,encodeListPreference} from '@/lib/list-state';
const section=location.pathname.slice(1), product=section==='products';
window.__section=section;window.__hold=false;window.__navigation=[];window.__mutations=[];window.__focusStates=[];
const number=product?'199.5':'199';window.__number=number;
const common={title:'Стеллаж',statusChangedAt:new Date().toISOString(),stageChangedAt:new Date().toISOString(),
 expectedPrice:null,totalPrice:null,quantity:1,currency:'BYN',clientId:'client',clientName:'Клиент',managerName:null,
 projectId:'parent',projectStage:'IN_WORK',projectNumber:'199',projectTitle:'Заказ',engineerId:null,engineerName:null,
 isEngineeringParticipant:false,hasB3d:false,noModel:true,sketchFile:null,coverFile:null,hasMaterialShortage:false,
 tasksCount:0,filesCount:0,productsCount:1};
const cover={id:'qa176-focus-cover',fileName:'focus.png',mimeType:'image/png',hasThumb:true};
const all=[...Array.from({length:12},(_,i)=>({...common,id:'partial-'+i,number:number+String(99-i),
 title:'Совпадение '+i,status:'INSTALLATION',stage:'IN_WORK'})),
 {...common,id:'target',number,status:'INSTALLATION',stage:'IN_WORK',title:'Искомая карточка',sketchFile:cover,coverFile:cover},
 {...common,id:'start',number:'100.1',status:'PREPARATION',stage:'LEAD',title:'Начало'},
 {...common,id:'end',number:'800.1',status:'DONE',stage:'REFUSED',title:'Конец'}];
function rows(query){const p=new URLSearchParams(query),q=p.get('q')?.trim()||'',selected=parseListFilterValue(p.get(product?'status':'stage'));return all.filter(row=>(!window.__omitTarget||row.id!=='target')&&(!q||row.number.includes(q)||row.title.toLowerCase().includes(q.toLowerCase()))&&(!selected||selected.includes(product?row.status:row.stage))).map(row=>({...row}));}
window.__all=all;
function Controls(){const state=useListParams();window.__setFilters=state.set;window.__clientQuery=state.query;window.__pending=state.pending;return null;}
function App(){const initial=normalizeListQuery(section,location.search.slice(1));
 const [mounted,setMounted]=React.useState(true);window.__unmount=()=>setMounted(false);
 const [roles,setRoles]=React.useState(['ADMIN']);window.__setRoles=setRoles;
 const [result,setResult]=React.useState(()=>({query:initial,rows:rows(initial),preference:encodeListPreference(section,initial,'initial')}));
 window.__accept=query=>setResult({query,rows:rows(query),preference:encodeListPreference(section,query,'accepted')});
 window.__refresh=()=>setResult(previous=>({...previous,rows:previous.rows.map(row=>({...row}))}));
 window.__repeatResponse=()=>setResult(previous=>({...previous}));
 window.__clearTarget=()=>setResult(previous=>({...previous,rows:previous.rows.filter(row=>row.id!=='target')}));
 const view=new URLSearchParams(result.query).get('view')==='table'?'table':'kanban';
 return <><aside style={{display:window.innerWidth<768?'none':'block',position:'fixed',top:0,left:0,width:240,height:'100vh',background:'#f2f2f2'}}>PERO QA</aside>
 <main style={{marginLeft:window.innerWidth<768?0:240,padding:16,minWidth:0}}>{mounted&&<ListParamsProvider section={section} initialQuery={result.query} preference={result.preference}><Controls/>
 {product?<ProductsView resolvedQuery={result.query} view={view} products={result.rows} total={result.rows.length} page={1} pageSize={10} canManage actorRoles={roles} showAmount={false} projectOptions={[]} clientOptions={[]} engineerOptions={[]}/>
 :<ProjectsView resolvedQuery={result.query} view={view} projects={result.rows} total={result.rows.length} page={1} pageSize={10} canManage showAmount={false} clients={[]} managers={[]} engineers={[]}/>}</ListParamsProvider>}</main><div style={{height:1200}}/></>;
}createRoot(document.getElementById('root')).render(<App/>);
`;
const boundaries = {
  "@/components/kanban-scroll-area": `import React from 'react';import {KanbanScrollArea as Actual} from ${JSON.stringify(path.join(web, "src/components/kanban-scroll-area.tsx").split(path.sep).join("/"))};export function KanbanScrollArea(props){window.__focusStates?.push(props.searchFocus);React.useEffect(()=>{window.__committedFocus=props.searchFocus;},[props.searchFocus]);return <Actual {...props}/>;}`,
  "next/navigation": `export const useRouter=()=>({replace:(href)=>{const q=href.split('?')[1]||'';window.__navigation.push(q);if(!window.__hold)window.__accept(q);},push:href=>window.__opened=href,refresh:()=>{if(!window.__holdRefresh)window.__refresh()}});export const usePathname=()=>location.pathname;`,
  "next/link": `import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}`,
  "@/server/list-preferences-actions": `import {encodeListPreference} from '@/lib/list-state';export async function saveListPreference(section,query){window.__savedQuery=query;if(window.__holdSave)await new Promise(resolve=>window.__releaseSave=resolve);return {ok:true,value:encodeListPreference(section,query,'saved')}}`,
  "@/server/projects/stage-actions": `export async function patchProjectStage(value){window.__mutations.push(value);return {ok:true,stage:value.toStage}}`,
  "@/server/products/actions": `export async function changeProductStatus(id,status){window.__mutations.push({id,status});if(window.__holdStatus)await new Promise(resolve=>window.__releaseStatus=resolve);if(window.__statusFail)return {ok:false,error:'QA confirmed rollback'};const row=window.__all.find(item=>item.id===id);if(row)row.status=status;return {ok:true}}`,
  "@/server/projects/actions": `export async function createProject(){throw Error('not in QA scope')}`,
  "@/server/clients/actions": `export async function createClient(){throw Error('not in QA scope')}`,
};
const bundle = await build({metafile:true,stdin:{contents:entry,loader:"tsx",resolveDir:web},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",tsconfig:path.join(web,"tsconfig.json"),define:{"process.env.NODE_ENV":'"development"'},plugins:[{
 name:"http-boundaries",setup(builder){builder.onResolve({filter:/^(?:next\/(?:navigation|link)|@\/server\/|@\/components\/kanban-scroll-area$)/},args=>boundaries[args.path]?{path:args.path,namespace:"qa-boundary"}:undefined);
 builder.onLoad({filter:/.*/,namespace:"qa-boundary"},args=>({contents:boundaries[args.path],loader:"tsx",resolveDir:web}));}
}]});
const productionInputs=Object.keys(bundle.metafile.inputs)
 .filter(input=>!input.includes('node_modules')&&!input.startsWith('qa-boundary:')&&input!=='<stdin>')
 .map(input=>path.resolve(web,input));
assert.ok(productionInputs.length>30,'ACTUAL_QA_PRODUCTION_CLOSURE_REQUIRED');
for(const input of productionInputs)assert.ok(input.startsWith(web+path.sep),'QA_PRODUCTION_IMPORT_OUTSIDE_CURRENT_CHECKOUT');
await writeFile(path.join(directory,'bundle-metafile.json'),JSON.stringify(bundle.metafile,null,2));
const postcss=createRequire(require.resolve("@tailwindcss/postcss"))("postcss"),tailwind=require("@tailwindcss/postcss");
const css=(await postcss([tailwind({base:web})]).process(await readFile(path.join(web,"src/app/globals.css"),"utf8"),{from:path.join(web,"src/app/globals.css")})).css;
const server=createServer((request,response)=>{
 const url=new URL(request.url,"http://localhost");
 if(url.pathname==='/api/files/qa176-focus-cover'){response.setHeader('content-type','image/png');response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwb3/5HwAFhwK3tfHguAAAAABJRU5ErkJggg==','base64'));return;}
 response.setHeader("content-type",url.pathname==="/app.js"?"text/javascript":url.pathname==="/app.css"?"text/css":"text/html");
 response.end(url.pathname==="/app.js"?bundle.outputFiles[0].text:url.pathname==="/app.css"?css:'<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body style="font-family:Arial,sans-serif"><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true}),checks=[],screenshots=[];
function target(page,section){return page.getByText(section==="products"?"199.5":"199",{exact:true}).locator(`xpath=ancestor::*[@data-slot="${section==="products"?"product":"project"}-kanban-card"][1]`);}
async function geometry(page,section){return target(page,section).evaluate(card=>{
 const board=card.closest('[data-slot="kanban-scroll"]'),b=board.getBoundingClientRect(),r=card.getBoundingClientRect();
 const visibleCenter=(Math.max(0,b.left)+Math.min(innerWidth,b.right))/2;
 const clamp=(value,max)=>Math.max(0,Math.min(max,value));
 const wantedLeft=clamp(board.scrollLeft+r.left+r.width/2-visibleCenter,board.scrollWidth-board.clientWidth);
 const wantedTop=clamp(scrollY+r.top+r.height/2-innerHeight/2,document.scrollingElement.scrollHeight-innerHeight);
 return {left:board.scrollLeft,top:scrollY,wantedLeft,wantedTop,xError:Math.abs(board.scrollLeft-wantedLeft),yError:Math.abs(scrollY-wantedTop),rect:{x:r.x,y:r.y,width:r.width,height:r.height},snap:getComputedStyle(board).scrollSnapType,bottom:document.querySelector('[data-kanban-scrollbar]')?.scrollLeft};
 });}
async function settledCenter(page,section){await expect.poll(async()=>{const g=await geometry(page,section);return Math.max(g.xError,g.yError);},{timeout:5000}).toBeLessThan(2);}
const waitFrames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const position=page=>page.evaluate(()=>({left:document.querySelector('[data-slot="kanban-scroll"]')?.scrollLeft,top:scrollY}));
function assertManualScrollPreserved(actual,expected){
 for(const axis of ['left','top']){
  const delta=actual[axis]-expected[axis];
  assert.ok(Number.isFinite(actual[axis])&&Number.isFinite(expected[axis])&&Number.isFinite(delta)&&Math.abs(delta)<=1,
   `Ручной scroll ${axis} изменился на ${delta} CSS px`);
 }
}
async function resetPosition(page){
 // Сначала завершаем предыдущий поиск: прежний центр не доказывает завершённый focus RAF.
 await expect.poll(()=>page.evaluate(()=>{const focus=window.__focusStates.at(-1),q=new URLSearchParams(window.__clientQuery).get('q')??'';return !window.__pending&&focus?.ready===true&&focus.query.trim()===q;}),{timeout:5000}).toBe(true);
 await waitFrames(page);
 await page.evaluate(()=>{document.querySelector('[data-slot="kanban-scroll"]').scrollTo({left:0,behavior:'instant'});scrollTo({top:0,behavior:'instant'});});
 // Два RAF сами по себе не подтверждают доставку scroll-событий между двумя полосами.
 await expect.poll(()=>page.evaluate(()=>({left:document.querySelector('[data-slot="kanban-scroll"]').scrollLeft,bottom:document.querySelector('[data-kanban-scrollbar]')?.scrollLeft??0,top:scrollY})),{timeout:5000}).toEqual({left:0,bottom:0,top:0});
 await waitFrames(page);
}
async function layout(page){return page.evaluate(()=>({columns:[...document.querySelectorAll('[data-slot="kanban-column"]')].map(column=>({width:column.offsetWidth,x:column.offsetLeft,label:column.firstElementChild.textContent.replace(/\d+$/,'')})),cards:[...document.querySelectorAll('[data-kanban-card-id]')].map(card=>({id:card.dataset.kanbanCardId,width:card.offsetWidth,height:card.offsetHeight}))}));}
async function makePage(section,viewport={width:1440,height:900},query=''){
 const page=await browser.newPage({viewport,hasTouch:viewport.width<768,reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',error=>errors.push(String(error)));page.__errors=errors;
 await page.addInitScript(()=>{
  window.__focusMoves={board:0,page:0};
  const boardScroll=HTMLElement.prototype.scrollTo,pageScroll=window.scrollTo;
  HTMLElement.prototype.scrollTo=function(...args){if(this.dataset.slot==='kanban-scroll'&&args[0]?.behavior==='instant')window.__focusMoves.board++;return boardScroll.apply(this,args);};
  window.scrollTo=function(...args){if(args[0]?.behavior==='instant')window.__focusMoves.page++;return pageScroll.apply(this,args);};
 });
 await page.goto(origin+'/'+section+(query?'?'+query:''),{waitUntil:'domcontentloaded'});await page.locator('[data-slot="kanban-scroll"]').waitFor();await waitFrames(page);return page;
}
async function finish(page){assert.deepEqual(page.__errors,[]);await page.close();}
const expectedQ=section=>section==='products'?'199.5':'199';
const search=page=>page.getByPlaceholder('Номер, название…');
async function apply(page,q){await search(page).fill(q);await expect.poll(()=>page.evaluate(()=>new URLSearchParams(window.__clientQuery).get('q'))).toBe(q||null);await expect.poll(()=>page.evaluate(()=>window.__pending)).toBe(false);await waitFrames(page);}
try{
 for(const section of sections){
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   const delayed=await makePage(section,viewport),q=expectedQ(section);
   await delayed.evaluate(()=>{const style=document.createElement('style');style.id='late-card';style.textContent='[data-kanban-card-id="target"]{display:none!important}';document.head.append(style);});
   if(viewport.width<768)await delayed.getByRole('button',{name:'Фильтры',exact:true}).click();
   await apply(delayed,q);
   if(viewport.width<768){await delayed.getByRole('button',{name:'Показать результаты',exact:true}).click();await expect(delayed.getByRole('dialog')).toHaveCount(0);}
   await expect.poll(()=>delayed.evaluate(()=>window.__committedFocus?.ready)).toBe(true);
   await waitFrames(delayed);assert.deepEqual(await delayed.evaluate(()=>window.__focusMoves),{board:0,page:0});
   await delayed.evaluate(()=>window.__focusBeforeCard=document.activeElement);
   await delayed.evaluate(()=>document.getElementById('late-card').remove());await settledCenter(delayed,section);
   assert.deepEqual(await delayed.evaluate(()=>window.__focusMoves),{board:1,page:1});
   assert.equal(await delayed.evaluate(()=>document.activeElement===window.__focusBeforeCard),true);
   if(viewport.width>=768)assert.deepEqual(await search(delayed).evaluate(input=>({active:document.activeElement===input,start:input.selectionStart,end:input.selectionEnd})),{active:true,start:q.length,end:q.length});
   checks.push(section+':'+viewport.width+':zero_size_target_waits_until_measurable_once');await finish(delayed);
  }

  const inserted=await makePage(section);
  await inserted.evaluate(()=>{const card=document.querySelector('[data-kanban-card-id="target"]');window.__lateCard=card;window.__lateParent=card.parentElement;card.remove();});
  await apply(inserted,expectedQ(section));await waitFrames(inserted);assert.deepEqual(await inserted.evaluate(()=>window.__focusMoves),{board:0,page:0});
  await inserted.evaluate(()=>window.__lateParent.append(window.__lateCard));await settledCenter(inserted,section);
  assert.deepEqual(await inserted.evaluate(()=>window.__focusMoves),{board:1,page:1});checks.push(section+':late_DOM_target_waits_until_inserted_once');await finish(inserted);

  const q=expectedQ(section),page=await makePage(section),before=await layout(page);
  await apply(page,q);await settledCenter(page,section);await waitFrames(page);
  const g=await geometry(page,section);assert.ok(g.left>0&&g.top>0);assert.deepEqual(await page.evaluate(()=>window.__focusMoves),{board:1,page:1},'one exact query must cause one board/page transition');assert.ok(Math.abs(g.bottom-g.left)<2);
  assert.deepEqual(await search(page).evaluate(input=>({active:document.activeElement===input,start:input.selectionStart,end:input.selectionEnd})),{active:true,start:q.length,end:q.length});
  const after=await layout(page);assert.deepEqual(after.columns,before.columns);assert.deepEqual(after.cards,before.cards.filter(card=>card.id!=='start'&&card.id!=='end'));
  checks.push(section+':exact_far_column_page_center_caret_bottom_sync_unchanged_layout');
  let screenshot=path.join(directory,section+'-1440.png');await page.screenshot({path:screenshot});screenshots.push(screenshot);

  await resetPosition(page);const manually=await position(page),manualMoves=await page.evaluate(()=>window.__focusMoves);await page.evaluate(()=>window.__refresh());await waitFrames(page);assert.deepEqual(await position(page),manually);assert.deepEqual(await page.evaluate(()=>window.__focusMoves),manualMoves);
  checks.push(section+':manual_scroll_and_SSE_no_recenter');
  await apply(page,'');await apply(page,q);await settledCenter(page,section);checks.push(section+':clear_reenter_same_exact_number');
  await resetPosition(page);await search(page).fill('');await search(page).fill(q);await settledCenter(page,section);checks.push(section+':rapid_draft_clear_reenter_before_debounce');
  for(const term of ['Искомая',q+'9','NoMatch117']){await resetPosition(page);await apply(page,term);assert.deepEqual(await position(page),{left:0,top:0});}
  assert.equal(await page.locator('[data-kanban-card-id]').count(),0);checks.push(section+':title_partial_number_no_match_no_autoscroll');
  await page.getByLabel('Таблица',{exact:true}).click();await expect(page.getByPlaceholder(section==='projects'?'Номер, название, клиент…':'Номер, название, проект, клиент…')).toBeVisible();assert.equal(await page.locator('[data-slot="kanban-scroll"]').count(),0);
  checks.push(section+':table_keeps_old_placeholder_and_no_board_focus');await finish(page);

  const stale=await makePage(section);await stale.evaluate(()=>{window.__hold=true;window.__holdSave=true;});
  await search(stale).fill(q+'9');await expect.poll(()=>stale.evaluate(()=>window.__pending)).toBe(true);assert.deepEqual(await position(stale),{left:0,top:0});
  await stale.evaluate(()=>{window.__holdSave=false;window.__releaseSave();});await expect.poll(()=>stale.evaluate(()=>window.__navigation.length)).toBe(1);
  await apply(stale,q);assert.deepEqual(await position(stale),{left:0,top:0});
  await stale.evaluate(()=>window.__accept(window.__navigation[0]));await waitFrames(stale);assert.deepEqual(await position(stale),{left:0,top:0});assert.equal(await search(stale).inputValue(),q);
  await stale.evaluate(()=>window.__accept(window.__navigation.at(-1)));await settledCenter(stale,section);checks.push(section+':pending_and_stale_RSC_wait_for_current_query_rows');await finish(stale);

  const missing=await makePage(section);await missing.evaluate(()=>window.__omitTarget=true);await apply(missing,q);assert.deepEqual(await position(missing),{left:0,top:0});
  // Подтверждаем commit отсутствующего совпадения до имитации следующего SSE.
  await expect.poll(()=>missing.evaluate(()=>{const focus=window.__committedFocus;return focus?.query===window.__number&&focus.ready===true&&focus.cardId===null;}),{timeout:5000}).toBe(true);
  await missing.evaluate(()=>{window.__omitTarget=false;window.__accept(window.__clientQuery)});await waitFrames(missing);assert.equal(await missing.locator('[data-kanban-card-id="target"]').count(),1);assert.deepEqual(await position(missing),{left:0,top:0});checks.push(section+':missing_exact_consumed_no_late_SSE_focus');await finish(missing);

  const axes=await makePage(section);await axes.evaluate(()=>window.__hold=true);await apply(axes,q);
  await axes.evaluate(section=>window.__setFilters({[section==='products'?'status':'stage']:'DONE'}),section);await expect.poll(()=>axes.evaluate(()=>window.__navigation.length)).toBe(2);
  await axes.evaluate(()=>window.__accept(window.__navigation[0]));await waitFrames(axes);assert.deepEqual(await position(axes),{left:0,top:0});
  await axes.evaluate(()=>window.__accept(window.__navigation[1]));await waitFrames(axes);assert.equal(await axes.locator('[data-kanban-card-id]').count(),0);assert.deepEqual(await position(axes),{left:0,top:0});
  checks.push(section+':same_search_stale_filter_axes_cannot_center_excluded_card');await finish(axes);

  const drag=await makePage(section);await drag.evaluate(()=>window.__hold=true);await apply(drag,q);
  const handle=drag.getByRole('button',{name:'Перетащить Начало',exact:true}),box=await handle.boundingBox();assert.ok(box);
  await drag.mouse.move(box.x+box.width/2,box.y+box.height/2);await drag.mouse.down();await drag.mouse.move(box.x+box.width/2+15,box.y+box.height/2+15,{steps:3});await waitFrames(drag);
  assert.equal(await drag.locator('[data-kanban-card-id="start"]').count(),1,'DragOverlay is not a focus target');
  await drag.evaluate(()=>window.__accept(window.__navigation.at(-1)));await waitFrames(drag);assert.deepEqual(await position(drag),{left:0,top:0});
  await drag.mouse.up();await settledCenter(drag,section);assert.deepEqual(await drag.evaluate(()=>window.__mutations),[]);checks.push(section+':active_DnD_defers_focus_until_finish_overlay_not_target');await finish(drag);

  if(section==='products'){
   const excluded=await makePage(section);await excluded.evaluate(()=>window.__hold=true);await apply(excluded,q);
   await excluded.evaluate(()=>{window.__focusStates=[];window.__omitTarget=true;window.__accept(window.__clientQuery);});await waitFrames(excluded);
   const excludedStates=await excluded.evaluate(()=>window.__focusStates.filter(state=>state?.query===window.__number));
   assert.ok(excludedStates.some(state=>state.cardId==='target'&&!state.ready),'new response render must not confirm old filtered rows before effect commit');
   assert.ok(excludedStates.some(state=>state.cardId===null&&state.ready),'empty exact result becomes confirmed only with applied rows');
   assert.deepEqual(await position(excluded),{left:0,top:0});assert.deepEqual(await excluded.evaluate(()=>window.__focusMoves),{board:0,page:0});
   await excluded.evaluate(()=>{window.__omitTarget=false;window.__accept(window.__clientQuery);});await waitFrames(excluded);assert.deepEqual(await excluded.evaluate(()=>window.__focusMoves),{board:0,page:0});assert.equal(await excluded.locator('[data-kanban-card-id="target"]').count(),1);
   checks.push('products:current_response_old_rows_unready_empty_exact_consumed_no_late_focus');await finish(excluded);

   const roles=await makePage(section);await roles.evaluate(()=>window.__hold=true);await apply(roles,q);
   await roles.evaluate(()=>{window.__focusStates=[];window.__setRoles(['ENGINEER']);window.__accept(window.__clientQuery);});await waitFrames(roles);
   const roleStates=await roles.evaluate(()=>window.__focusStates.filter(state=>state?.query===window.__number));
   assert.ok(roleStates.some(state=>state.cardId==='target'&&!state.ready),'new role props cannot confirm rows from the previous role');
   assert.ok(roleStates.some(state=>state.cardId===null&&state.ready));assert.equal(await roles.locator('[data-kanban-card-id="target"]').count(),0);
   assert.deepEqual(await roles.evaluate(()=>window.__focusMoves),{board:0,page:0});checks.push('products:new_roles_wait_for_applied_permission_filter_never_scroll_to_hidden_card');await finish(roles);
  }

  if(section==='products')for(const failStatus of [false,true]){
   const optimistic=await makePage(section);await optimistic.evaluate(fail=>{window.__hold=true;window.__holdStatus=true;window.__holdRefresh=true;window.__statusFail=fail;},failStatus);
   await apply(optimistic,'100.1');const handle=optimistic.getByRole('button',{name:'Перетащить Начало',exact:true}),box=await handle.boundingBox();assert.ok(box);
   await optimistic.mouse.move(box.x+box.width/2,box.y+box.height/2);await optimistic.mouse.down();await optimistic.mouse.move(box.x+box.width/2+15,box.y+box.height/2+15,{steps:3});await waitFrames(optimistic);
   await expect(optimistic.locator('[data-slot="product-kanban-card"].rotate-2')).toHaveCount(2);
   await optimistic.evaluate(()=>window.__accept(window.__clientQuery));await waitFrames(optimistic);assert.deepEqual(await optimistic.evaluate(()=>window.__focusMoves),{board:0,page:0});
   await expect(optimistic.locator('[data-slot="product-kanban-card"].rotate-2')).toHaveCount(2);
   const destination=await optimistic.locator('[data-slot="kanban-column"]').filter({has:optimistic.getByText('Проектирование',{exact:true})}).boundingBox();assert.ok(destination);
   await optimistic.mouse.move(destination.x+destination.width/2,destination.y+80,{steps:8});await waitFrames(optimistic);await expect(optimistic.locator('[data-slot="kanban-column"]').filter({has:optimistic.getByText('Проектирование',{exact:true})})).toHaveClass(/border-primary/);await optimistic.mouse.up();await expect.poll(()=>optimistic.evaluate(()=>window.__mutations.length)).toBe(1);await waitFrames(optimistic);
   assert.deepEqual(await optimistic.evaluate(()=>window.__focusMoves),{board:0,page:0},'optimistic rows cannot confirm current search after DnD ends');
   await optimistic.evaluate(()=>window.__repeatResponse());await waitFrames(optimistic);assert.deepEqual(await optimistic.evaluate(()=>window.__focusMoves),{board:0,page:0},'same source props remain unconfirmed after local change');
   await optimistic.evaluate(()=>window.__releaseStatus());await waitFrames(optimistic);assert.deepEqual(await optimistic.evaluate(()=>window.__focusMoves),{board:0,page:0},'local success or rollback awaits authoritative rows');
   await optimistic.evaluate(()=>window.__accept(window.__clientQuery));await waitFrames(optimistic);await expect.poll(()=>optimistic.evaluate(()=>window.__focusMoves)).toEqual({board:1,page:1});
   assert.equal(await optimistic.locator('[data-kanban-card-id="start"]').count(),1);checks.push('products:optimistic_rows_wait_for_authoritative_response_'+(failStatus?'confirmed_rollback':'success'));await finish(optimistic);
  }

  const resized=await makePage(section,{width:390,height:844});await resized.getByRole('button',{name:'Фильтры',exact:true}).click();await expect(resized.getByRole('dialog')).toBeVisible();
  await resized.setViewportSize({width:1440,height:900});await expect(resized.getByRole('dialog')).toHaveCount(0);
  await resized.setViewportSize({width:390,height:844});await expect(resized.getByRole('dialog')).toBeVisible();await apply(resized,q);await waitFrames(resized);
  assert.equal(await resized.getByRole('dialog').count(),1);assert.deepEqual(await position(resized),{left:0,top:0},'returning mobile open Sheet still blocks focus');
  await resized.getByRole('button',{name:'Показать результаты',exact:true}).click();await expect(resized.getByRole('dialog')).toHaveCount(0);await settledCenter(resized,section);
  checks.push(section+':open_Sheet_mobile_desktop_mobile_stays_blocked_until_close');await finish(resized);

  for(const viewport of [{width:390,height:844},{width:360,height:800}]){
   const restored=await makePage(section,viewport,'view=kanban&q='+encodeURIComponent(q));await settledCenter(restored,section);await restored.waitForTimeout(300);const restoredGeometry=await geometry(restored,section);assert.ok(restoredGeometry.xError<2&&restoredGeometry.yError<2);checks.push(section+':'+viewport.width+':initial_saved_query_mobile_layout_settles');await finish(restored);
   const mobile=await makePage(section,viewport),initialLayout=await layout(mobile);
   const nativeSnap=await mobile.locator('[data-slot="kanban-scroll"]').evaluate(board=>getComputedStyle(board).scrollSnapType);assert.ok(nativeSnap==='x'||nativeSnap==='x proximity','Chrome serializes proximity as its default');
   await mobile.getByRole('button',{name:'Фильтры',exact:true}).click();await expect(mobile.getByRole('dialog')).toBeVisible();await apply(mobile,q);
   assert.equal(await mobile.getByRole('dialog').count(),1);assert.deepEqual(await position(mobile),{left:0,top:0});
   await mobile.getByRole('button',{name:'Показать результаты',exact:true}).click();await expect(mobile.getByRole('dialog')).toHaveCount(0);await settledCenter(mobile,section);await mobile.waitForTimeout(300);
   const focused=await geometry(mobile,section);assert.ok(focused.xError<2&&focused.yError<2);assert.equal(focused.snap,'none');assert.ok(Math.abs(focused.bottom-focused.left)<2);assert.deepEqual((await layout(mobile)).columns,initialLayout.columns);
   screenshot=path.join(directory,section+'-'+viewport.width+'.png');await mobile.screenshot({path:screenshot});screenshots.push(screenshot);
   checks.push(section+':'+viewport.width+':Sheet_wait_complete_close_center_layout_and_bottom_sync');

   // Настоящий touch-жест восстанавливает исходный snap до обычной прокрутки.
   // Ручную позицию фиксируем после настоящего scrollend, включая инерцию и CSS snap.
   await mobile.locator('[data-slot="kanban-scroll"]').evaluate(board=>{
    window.__manualTouchSettled=false;
    window.addEventListener('touchend',()=>board.addEventListener('scrollend',()=>{window.__manualTouchSettled=true;},{once:true}),{once:true});
   });
   const cdp=await mobile.context().newCDPSession(mobile);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:viewport.width-30,y:viewport.height/2}]});
   for(const x of [viewport.width-80,viewport.width-150,70])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:viewport.height/2}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await expect.poll(()=>mobile.evaluate(()=>window.__manualTouchSettled),{timeout:5000}).toBe(true);
   // scrollend не доказывает доставку зеркальных scroll-событий: снимок берём после точной стабилизации.
   await expect.poll(()=>mobile.evaluate(async()=>{
    const board=document.querySelector('[data-slot="kanban-scroll"]'),bar=document.querySelector('[data-kanban-scrollbar]');
    if(!bar||board.scrollLeft!==bar.scrollLeft)return false;
    const left=board.scrollLeft,top=scrollY;
    for(let frame=0;frame<4;frame++){
     await new Promise(resolve=>requestAnimationFrame(resolve));
     if(board.scrollLeft!==left||bar.scrollLeft!==left||scrollY!==top)return false;
    }
    return true;
   }),{timeout:5000}).toBe(true);
   await cdp.detach();
   assert.equal(await mobile.locator('[data-slot="kanban-scroll"]').evaluate(board=>getComputedStyle(board).scrollSnapType),nativeSnap);
   const manual=await position(mobile),manualMoves=await mobile.evaluate(()=>window.__focusMoves);assert.ok(Math.abs(manual.left-focused.left)>10);await mobile.evaluate(()=>window.__refresh());await waitFrames(mobile);assertManualScrollPreserved(await position(mobile),manual);assert.deepEqual(await mobile.evaluate(()=>window.__focusMoves),manualMoves);
   // Основная полоса уже подтверждена; её scroll-событие ещё может не доставить зеркало в CI.
   await expect.poll(async()=>Math.abs((await mobile.locator('[data-kanban-scrollbar]').evaluate(bar=>bar.scrollLeft))-manual.left),{timeout:5000}).toBeLessThan(2);
   assertManualScrollPreserved(await position(mobile),manual);assert.deepEqual(await mobile.evaluate(()=>window.__focusMoves),manualMoves);
   assert.ok(Math.abs((await mobile.locator('[data-kanban-scrollbar]').evaluate(bar=>bar.scrollLeft))-manual.left)<2);
   assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);checks.push(section+':'+viewport.width+':real_touch_restores_snap_manual_scroll_and_SSE');await finish(mobile);
  }
 }
 const receipt={status:'PASS',checks,screenshots,sourceClosure:{web,productionInputs},mode:'actual React Views, query controller, filters, DnD, Base UI and Tailwind; controlled server transport; no DB'};
 await writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}catch(error){const receipt={status:'FAIL',error:String(error),checks};await writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));throw error;}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
