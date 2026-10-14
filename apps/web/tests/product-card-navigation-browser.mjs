const ENTRY="import React from 'react';import {createRoot} from 'react-dom/client';\nimport {ProductsTab} from '@/app/(app)/projects/[id]/products-tab';\nimport {ProductsKanban} from '@/app/(app)/products/products-kanban';\nimport {ProjectsTable} from '@/app/(app)/projects/projects-table';\nimport {ProductsTable} from '@/app/(app)/products/products-table';\nimport {ListParamsProvider} from '@/lib/list-params';\nimport {ProductKanbanCard} from '@/components/product-kanban-card';import {ProjectKanbanCard} from '@/components/project-kanban-card';import {ProductHeroImage} from '@/components/product-hero-image';\nconst query='view=kanban&q=qa160&active=0&sort=number&dir=asc';\nconst common={status:'DESIGN',statusChangedAt:'2026-10-01T00:00:00.000Z',quantity:1,\n expectedPrice:null,engineerId:null,engineerName:null,isEngineeringParticipant:false,hasB3d:false,noModel:true,\n currency:'BYN',projectStage:'IN_WORK',projectId:'qa160-project',projectNumber:'160',projectTitle:'Проект QA160',\n clientId:'qa160-client',clientName:'Клиент QA160',kind:null};\nconst rows=['a','b'].map((key,index)=>({...common,id:'qa160-'+key,number:'160.'+(index+1),title:'Карточка '+key.toUpperCase(),\n sketchFile:{id:'qa160-'+key+'-cover',fileName:'cover.png',mimeType:'image/png',hasThumb:true}}));\nconst projects=[{id:'qa160-project',number:'160',title:'Проект QA160',clientName:'Клиент QA160',currency:'BYN',\n totalPrice:null,stage:'IN_WORK',stageChangedAt:'2026-10-01T00:00:00.000Z',productsCount:2,\n managerName:null,coverFile:null,hasMaterialShortage:false}];\nconst roles=['ADMIN'],scope=location.pathname.slice(1);\nwindow.__qa={scope,pushes:[],unexpected:[],clicks:[],query,naturalOpened:0,naturalBubbled:0};\ndocument.addEventListener('click',event=>window.__qa.clicks.push({trusted:event.isTrusted,\n cover:!!event.target.closest('[data-slot=\"product-kanban-image\"]')}),true);\nfunction Natural(){const [dragging,setDragging]=React.useState(false);return <><button id=\"natural-dragging\" onClick={()=>setDragging(!dragging)}>Переключить dragging</button><main className=\"grid grid-cols-1 gap-4 md:grid-cols-2\" style={{maxWidth:616,margin:16,alignItems:'start'}}>{['landscape','square','portrait','slow','fullscreen','broken','empty'].flatMap(shape=>['product','project'].map(kind=>{const cover=shape==='empty'?null:{id:'qa160-natural-'+shape,fileName:shape+'.png',mimeType:'image/png',hasThumb:true};return <div data-natural={kind+'-'+shape} key={kind+shape} onClick={()=>window.__qa.naturalBubbled++}>{kind==='product'?<ProductKanbanCard product={{...common,number:'224.2',title:shape+' — изделие',expectedPrice:'1000',quantity:3,sketchFile:cover}} showAmount currency=\"BYN\" dragging={dragging} coverAction={shape==='fullscreen'?{type:'fullscreen'}:{type:'navigate',onOpen:()=>window.__qa.naturalOpened++}}/>:<ProjectKanbanCard project={{...projects[0],number:'224',title:shape+' — проект',totalPrice:'3000',coverFile:cover}} showAmount dragging={dragging} onOpen={()=>window.__qa.naturalOpened++}/>}</div>;}))}</main><div data-detail style={{width:240,height:320}}><ProductHeroImage sketch={{id:'qa160-natural-portrait',fileName:'original.png',mimeType:'image/png',hasThumb:true}} preview=\"cover\" className=\"h-full w-full\"/></div></>;}\nfunction App(){return <main style={{padding:16}}>{scope==='project'?\n <ProductsTab projectId=\"qa160-project\" projectStage=\"IN_WORK\" currency=\"BYN\" initialProducts={rows}\n canManage={false} actorRoles={roles} actorUserId=\"qa160-admin\" showAmount={false} engineerOptions={[]}/>:\n <ListParamsProvider section={scope==='project-table'?'projects':'products'} initialQuery={query} preference={null}>\n {scope==='global'?<ProductsKanban initialProducts={rows} actorRoles={roles} canManage={false} showAmount={false}/>:\n scope==='project-table'?<ProjectsTable projects={projects} total={1} page={1} pageSize={10} showAmount={false}\n onOpen={()=>window.__qa.unexpected.push('project-table-navigation')}/>:\n <ProductsTable products={rows} total={2} page={1} pageSize={10} showAmount={false}/>}\n </ListParamsProvider>}</main>;}\ncreateRoot(document.getElementById('root')).render(scope==='natural'?<Natural/>:<App/>);\n";
const BOUNDARIES={"next/navigation":"const unexpected=name=>{window.__qa.unexpected.push(name);throw Error('UNEXPECTED_QA_CALLBACK')};export const useRouter=()=>({push:href=>window.__qa.pushes.push(href),replace:()=>unexpected('replace'),refresh:()=>unexpected('refresh')});export const usePathname=()=>location.pathname;","next/link":"import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}","@/server/products/actions":"const reject=()=>{window.__qa.unexpected.push('products-action');throw Error('UNEXPECTED_SERVER_ACTION')};export async function changeProductStatus(){return reject()}export async function createProduct(){return reject()}","@/server/projects/stage-actions":"export async function patchProjectStage(){window.__qa.unexpected.push('project-stage-action');throw Error('UNEXPECTED_SERVER_ACTION')}","@/server/list-preferences-actions":"export async function saveListPreference(){window.__qa.unexpected.push('save-list-preference');throw Error('UNEXPECTED_SERVER_ACTION')}","@/server/projects/actions":"export async function createProject(){window.__qa.unexpected.push('create-project');throw Error('UNEXPECTED_SERVER_ACTION')}","@/server/clients/actions":"export async function createClient(){window.__qa.unexpected.push('create-client');throw Error('UNEXPECTED_SERVER_ACTION')}"};
// Проверяет реальные client components в Chromium; данные и transport синтетические.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const WEB=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),ROOT=path.resolve(WEB,'../..');
const SOURCE=path.join(WEB,'src'),require=createRequire(import.meta.url);
const BOARDS=['src/app/(app)/projects/[id]/products-tab.tsx','src/app/(app)/products/products-kanban.tsx'];
const VARIANTS=['baseline','formatting','cover-disabled','wrong-product'];
const IMAGE=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwb3/5HwAFhwK3tfHguAAAAABJRU5ErkJggg==','base64');
const sha=value=>createHash('sha256').update(value).digest('hex');
export class CardBrowserFailure extends Error{constructor(code,phase,evidence={}){super(code);this.name='CardBrowserFailure';this.code=code;this.phase=phase;this.evidence=evidence;}}
const fail=(code,phase,evidence)=>{throw new CardBrowserFailure(code,phase,evidence);};
export function fixtureRequestAllowed(method,url){
 const parsed=new URL(url,'http://qa160.invalid');
 if(method!=='GET'||parsed.origin!=='http://qa160.invalid')return false;
 if(['/project','/global','/project-table','/product-table','/natural'].includes(parsed.pathname))
  return parsed.searchParams.size===1&&parsed.searchParams.has('variant')&&VARIANTS.includes(parsed.searchParams.get('variant'));
 return parsed.search===''&&(parsed.pathname==='/app.css'||VARIANTS.some(v=>parsed.pathname==='/bundles/'+v+'.js'))||
  ['/api/files/qa160-a-cover','/api/files/qa160-b-cover',...['landscape','square','portrait','slow','fullscreen','broken'].map(shape=>'/api/files/qa160-natural-'+shape)].includes(parsed.pathname)&&
  (parsed.searchParams.size===0||(parsed.searchParams.size===1&&parsed.searchParams.has('preview')&&['card','cover'].includes(parsed.searchParams.get('preview'))));
}
export async function launchCardBrowser(launch){
 try{return await (launch??(async()=>{const{chromium}=await import('@playwright/test');return chromium.launch({headless:true,channel:'chromium'});}))();}
 catch{fail('BROWSER_UNAVAILABLE','browser-launch');}
}
function astShape(ts,node){const children=[];ts.forEachChild(node,n=>{children.push(astShape(ts,n));});return[node.kind,children.length===0&&typeof node.text==='string'?node.text:null,children];}
export function transformCardSource(ts,source,variant){
 assert.ok(VARIANTS.includes(variant),'UNKNOWN_CARD_VARIANT');
 if(variant==='baseline')return{contents:source,mutations:0};
 const ast=ts.createSourceFile('board.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed});
 if(variant==='formatting'){const contents=printer.printFile(ast);assert.deepEqual(astShape(ts,ts.createSourceFile('formatted.tsx',contents,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)),astShape(ts,ast),'FORMATTING_CHANGED_AST');return{contents,mutations:0};}
 let mutations=0;
 const transformed=ts.transform(ast,[context=>root=>{const visit=node=>{
  if(ts.isJsxAttribute(node)&&node.name.getText(ast)==='coverAction'&&node.initializer&&ts.isJsxExpression(node.initializer)&&node.initializer.expression&&ts.isObjectLiteralExpression(node.initializer.expression)){
   const object=node.initializer.expression;
   const properties=object.properties.map(property=>{
    if(!ts.isPropertyAssignment(property)||property.name.getText(ast)!=='onOpen')return property;
    assert.ok(ts.isArrowFunction(property.initializer)&&ts.isCallExpression(property.initializer.body),'MUTANT_LOCATION_UNAVAILABLE');
    const arrow=property.initializer,call=arrow.body;
    assert.equal(call.arguments.length,1,'MUTANT_LOCATION_UNAVAILABLE');mutations++;
    const body=variant==='cover-disabled'?ts.factory.createBlock([],false):ts.factory.updateCallExpression(call,call.expression,call.typeArguments,[
     ts.factory.createObjectLiteralExpression([ts.factory.createSpreadAssignment(call.arguments[0]),
      ts.factory.createPropertyAssignment('id',ts.factory.createStringLiteral('qa160-b')),
      ts.factory.createPropertyAssignment('number',ts.factory.createStringLiteral('160.2'))],false)]);
    return ts.factory.updatePropertyAssignment(property,property.name,ts.factory.updateArrowFunction(arrow,arrow.modifiers,arrow.typeParameters,arrow.parameters,arrow.type,arrow.equalsGreaterThanToken,body));
   });
   return ts.factory.updateJsxAttribute(node,node.name,ts.factory.updateJsxExpression(node.initializer,ts.factory.updateObjectLiteralExpression(object,properties)));
  }
  return ts.visitEachChild(node,visit,context);
 };return ts.visitNode(root,visit);}]);
 try{assert.equal(mutations,1,'MUTANT_LOCATION_UNAVAILABLE');const contents=printer.printFile(transformed.transformed[0]);assert.equal(ts.createSourceFile('emitted.tsx',contents,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX).parseDiagnostics.length,0,'MUTANT_SYNTAX_INVALID');return{contents,mutations};}finally{transformed.dispose();}
}
async function compileFixture(variant,dependencies){
 const files=new Map(),transforms=[],{build,ts}=dependencies;
 const buildResult=await build({stdin:{contents:ENTRY,loader:'tsx',resolveDir:WEB,sourcefile:'qa160-entry.tsx'},
  bundle:true,write:false,metafile:true,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(WEB,'tsconfig.json'),
  define:{'process.env.NODE_ENV':'"development"'},logLevel:'silent',plugins:[{name:'qa160-closed-boundaries',setup(builder){
   builder.onResolve({filter:/^(?:next\/|@\/server\/|@prisma\/client)/},args=>{
    if(!Object.hasOwn(BOUNDARIES,args.path))fail('UNEXPECTED_SERVER_IMPORT','compile');
    return{path:args.path,namespace:'qa160-boundary'};
   });
   builder.onLoad({filter:/.*/,namespace:'qa160-boundary'},args=>({contents:BOUNDARIES[args.path],loader:'tsx',resolveDir:WEB}));
   builder.onLoad({filter:/\.(?:tsx?|jsx?|mjs|cjs|json)$/,namespace:'file'},async args=>{
    const bytes=await readFile(args.path),originalSha256=sha(bytes);files.set(args.path,originalSha256);
    const relative=path.relative(WEB,args.path).split(path.sep).join('/');
    let contents=bytes.toString('utf8');
    if(BOARDS.includes(relative)){const changed=transformCardSource(ts,contents,variant);contents=changed.contents;transforms.push({file:relative,originalSha256,compiledSha256:sha(contents),variant,mutations:changed.mutations});}
    const extension=path.extname(args.path),loader=extension==='.tsx'?'tsx':extension==='.ts'?'ts':extension==='.jsx'?'jsx':extension==='.json'?'json':'js';
    return{contents,loader,resolveDir:path.dirname(args.path)};
   });
  }}]});
 assert.equal(transforms.length,2,'REAL_BOARD_INPUTS_REQUIRED');
 for(const [file,expected]of files)assert.equal(sha(await readFile(file)),expected,'INPUT_CHANGED_DURING_BUILD');
 const inputs=Object.keys(buildResult.metafile.inputs);
 for(const key of inputs)if(key.startsWith('qa160-boundary:'))assert.ok(Object.hasOwn(BOUNDARIES,key.slice('qa160-boundary:'.length)),'UNKNOWN_BOUNDARY_INPUT');
 assert.deepEqual(buildResult.metafile.outputs[Object.keys(buildResult.metafile.outputs)[0]].imports,[],'UNBUNDLED_IMPORT_REQUIRED');
 const bytes=Buffer.from(buildResult.outputFiles[0].contents);
 return{bytes,files,metafile:buildResult.metafile,transforms,bundleSha256:sha(bytes)};
}
async function frame(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
function targetCard(page){return page.locator('[data-slot="product-kanban-card"]').filter({has:page.getByText('160.1',{exact:true})});}
async function assertClickNavigation(page,target,expectedReturnTo,expect,kind){
 await page.evaluate(()=>{window.__qa.pushes=[];window.__qa.clicks=[];});
 await target.click();await frame(page);
 const result=await page.evaluate(()=>window.__qa);
 assert.equal(result.clicks.length,1,'ONE_TRUSTED_CLICK_REQUIRED');assert.equal(result.clicks[0].trusted,true,'TRUSTED_CLICK_REQUIRED');
 assert.equal(result.clicks[0].cover,kind==='cover','EXPECTED_CLICK_TARGET_REQUIRED');
 if(result.pushes.length===0)fail('NAVIGATION_MISSING','click-navigation',{ready:true,trusted:true,kind});
 if(result.pushes.length!==1)fail('DUPLICATE_NAVIGATION','click-navigation',{ready:true,trusted:true,kind});
 const url=new URL(result.pushes[0],'http://qa160.invalid');
 if(url.pathname!=='/products/160.1'||url.searchParams.get('returnTo')!==expectedReturnTo)fail('TARGET_MISMATCH','click-navigation',{ready:true,trusted:true,kind});
 assert.deepEqual([...url.searchParams.keys()],['returnTo']);assert.deepEqual(result.unexpected,[],'UNEXPECTED_CALLBACK');
 await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function runBoardPage(browser,origin,scope,variant,expect,checkDrag){
 const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'}),errors=[],unexpected=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin||!fixtureRequestAllowed(request.method(),url.pathname+url.search)){unexpected.push('UNEXPECTED_REQUEST');await route.abort();}else await route.continue();});
 try{
  await page.goto(origin+'/'+scope+'?variant='+variant,{waitUntil:'domcontentloaded',timeout:15000});
  const card=targetCard(page);await expect(card).toHaveCount(1);
  await card.scrollIntoViewIfNeeded();await expect.poll(()=>card.locator('img').evaluate(image=>image.complete&&image.naturalWidth>0),{timeout:5000}).toBe(true);
  const returnTo=scope==='project'?'/projects/qa160-project?tab=products':'/products?view=kanban&q=qa160&active=0&sort=number&dir=asc';
  await assertClickNavigation(page,card.getByRole('button',{name:'Открыть изделие Карточка A',exact:true}),returnTo,expect,'cover');
  const body=card.getByText('Карточка A',{exact:true});
  assert.equal(await body.evaluate(node=>!!node.closest('button,a,[data-slot="product-kanban-image"]')),false,'NONINTERACTIVE_BODY_REQUIRED');
  await assertClickNavigation(page,body,returnTo,expect,'body');
  if(checkDrag){
   await page.evaluate(()=>{window.__qa.pushes=[];window.__qa.clicks=[];});
   const handle=page.getByRole('button',{name:'Перетащить Карточка A',exact:true});await handle.scrollIntoViewIfNeeded();const box=await handle.boundingBox();assert.ok(box);
   const x=box.x+box.width/2,y=box.y+box.height/2;
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+14,y+14,{steps:3});
   const preview=page.getByRole('button',{name:'Открыть изображение Карточка A на весь экран',exact:true});
   await expect(preview).toBeVisible();await expect(preview).toBeDisabled();await expect(targetCard(page)).toHaveCount(2);
   // Реальный disabled preview проверяется внутри активного PointerSensor.
   // DOM click() не считается trusted-click доказательством; он должен оставаться без события.
   const clicks=await page.evaluate(()=>window.__qa.clicks.length);await preview.evaluate(button=>button.click());
   assert.equal(await page.evaluate(()=>window.__qa.clicks.length),clicks);
   await page.mouse.move(x,y,{steps:3});await page.mouse.up();await frame(page);
   await expect(preview).toHaveCount(0);await expect(targetCard(page)).toHaveCount(1);
   assert.deepEqual(await page.evaluate(()=>window.__qa.pushes),[]);assert.deepEqual(await page.evaluate(()=>window.__qa.unexpected),[]);
   await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  assert.deepEqual(errors,[],'BROWSER_RENDER_ERROR');assert.deepEqual(unexpected,[],'UNEXPECTED_NETWORK');
  return{scope,variant,ready:true,trustedCover:true,trustedBody:true,oneCorrectNavigation:true,dragPreview:checkDrag?'actual-pointer-disabled-no-navigation':'NOT_RUN'};
 }finally{await page.close();}
}
async function mobileNumbers(browser,origin,expect){
 const results=[];for(const scope of ['project-table','product-table']){
  const page=await browser.newPage({viewport:{width:390,height:844}});try{
   await page.goto(origin+'/'+scope+'?variant=baseline',{waitUntil:'domcontentloaded',timeout:15000});
   const expected=scope==='project-table'?['160']:['160.1','160.2'];
   for(const number of expected)await expect(page.locator('[data-card-number="true"]').filter({hasText:new RegExp('^'+number.replace('.','\\.')+'$')})).toBeVisible();
   assert.equal(await page.locator('[data-card-number="true"]').count(),expected.length);assert.deepEqual(await page.evaluate(()=>window.__qa.unexpected),[]);
   results.push({scope,numbers:expected,actualMobileDOM:true});
  }finally{await page.close();}
 }return results;
}
async function closeOwned(browser,server){
 const promises=[];if(browser)promises.push(browser.close());if(server?.listening){server.closeAllConnections();promises.push(new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())));}
 return(await Promise.allSettled(promises)).filter(result=>result.status==='rejected').map(result=>result.reason);
}
async function naturalImages(browser,origin,expect,release){
 const sizes={landscape:[1600,400],square:[800,800],portrait:[200,2000]},checks=[];
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:360,height:800}]){
  const page=await browser.newPage({viewport}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const geometry=img=>img.evaluate(image=>{const r=image.getBoundingClientRect(),p=image.parentElement.getBoundingClientRect(),style=getComputedStyle(image);return{width:r.width,height:r.height,left:r.left-p.left,top:r.top-p.top,right:p.right-r.right,bottom:p.bottom-r.bottom,fit:style.objectFit,position:style.objectPosition,naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight};});
  const frame=(box,label)=>{assert.ok(box.width>0&&Math.abs(box.height-box.width*4/3)<1,label);for(const edge of ['left','top','right','bottom'])assert.ok(Math.abs(box[edge])<1,label+' '+edge);};
  try{
   release(false);await page.goto(origin+'/natural?variant=baseline',{waitUntil:'domcontentloaded'});
   for(const kind of ['product','project']){const img=page.locator(`[data-natural="${kind}-slow"] img`);await img.scrollIntoViewIfNeeded();frame(await geometry(img),kind+' loading');assert.equal(await img.evaluate(image=>image.complete),false);}
   release(true);
   for(const kind of ['product','project']){
    for(const[shape,[width,height]]of Object.entries(sizes)){
     const img=page.locator(`[data-natural="${kind}-${shape}"] img`);await img.scrollIntoViewIfNeeded();await expect.poll(()=>img.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
     const box=await geometry(img);frame(box,kind+' '+shape);assert.equal(box.fit,'cover');assert.equal(box.position,'50% 50%');assert.deepEqual([box.naturalWidth,box.naturalHeight],[width,height]);
    }
    const slow=page.locator(`[data-natural="${kind}-slow"] img`);await slow.scrollIntoViewIfNeeded();await expect.poll(()=>slow.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);frame(await geometry(slow),kind+' loaded');
    const broken=page.locator(`[data-natural="${kind}-broken"]`);await broken.scrollIntoViewIfNeeded();const placeholder=broken.getByRole('img',{name:'Эскиз не загрузился'});await expect(placeholder).toBeVisible();const box=await placeholder.boundingBox();assert.ok(Math.abs(box.height-box.width*4/3)<1);
    const empty=page.locator(`[data-natural="${kind}-empty"]`);assert.equal(await empty.locator('img,[role="img"]').count(),0);assert.ok((await empty.boundingBox()).height<200);
   }
   const detail=page.locator('[data-detail] img');await detail.scrollIntoViewIfNeeded();await expect.poll(()=>detail.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);assert.equal((await geometry(detail)).fit,'contain');assert.equal(await detail.getAttribute('src'),'/api/files/qa160-natural-portrait?preview=cover');
   for(const kind of ['project','product'])await page.locator(`[data-natural="${kind}-landscape"] button`).click();assert.equal(await page.evaluate(()=>window.__qa.naturalOpened),2);assert.equal(await page.evaluate(()=>window.__qa.naturalBubbled),0);
   await page.locator('[data-natural="product-fullscreen"] button').click();const full=page.getByRole('dialog').locator('img');await expect(full).toBeVisible();await expect.poll(()=>full.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);assert.equal(await full.getAttribute('src'),'/api/files/qa160-natural-fullscreen');assert.equal((await geometry(full)).fit,'contain');
   await page.getByRole('button',{name:'Закрыть полноэкранный просмотр',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
   await page.locator('#natural-dragging').click();for(const kind of ['product','project'])await expect(page.locator(`[data-natural="${kind}-landscape"] button`)).toBeDisabled();
   await page.locator('#natural-dragging').click();await page.setViewportSize({width:viewport.width-20,height:viewport.height});for(const kind of ['product','project'])frame(await geometry(page.locator(`[data-natural="${kind}-portrait"] img`)),kind+' resized');
   await page.setViewportSize(viewport);await page.reload({waitUntil:'domcontentloaded'});
   for(const kind of ['product','project'])for(const shape of ['landscape','square','portrait','slow','fullscreen']){const img=page.locator(`[data-natural="${kind}-${shape}"] img`);await img.scrollIntoViewIfNeeded();await expect.poll(()=>img.evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);frame(await geometry(img),kind+' cached '+shape);}
   assert.deepEqual(errors,[]);checks.push({width:viewport.width,shapes:3,loading:true,broken:true,detail:true,fullscreen:true,resize:true,cached:true});
  }finally{release(true);await page.close();}
 }
 return checks;
}

export async function runProductCardNavigationGate(){
 let browser,server,failure,hasFailure=false,receipt;
 try{
  const configFiles=[path.join(ROOT,'package.json'),path.join(ROOT,'pnpm-lock.yaml'),path.join(ROOT,'pnpm-workspace.yaml'),path.join(WEB,'package.json'),path.join(WEB,'tsconfig.json')];
  const configuration=new Map();for(const file of configFiles)configuration.set(file,sha(await readFile(file)));
  const producerBefore=sha(await readFile(fileURLToPath(import.meta.url)));
  browser=await launchCardBrowser();
  const library=await import('@playwright/test'),expect=library.expect.configure({timeout:5000}),ts=require('typescript'),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
  const directory=path.join(WEB,'test-results/product-card-navigation',randomUUID());await mkdir(directory,{recursive:true});
  const fixtures={};for(const variant of VARIANTS)fixtures[variant]=await compileFixture(variant,{build,ts});
  const postcss=createRequire(require.resolve('@tailwindcss/postcss'))('postcss'),tailwind=require('@tailwindcss/postcss'),cssSource=await readFile(path.join(SOURCE,'app/globals.css'));
  const css=(await postcss([tailwind({base:WEB})]).process(cssSource.toString('utf8'),{from:path.join(SOURCE,'app/globals.css')})).css;
  const sharp=require('sharp'),assets=new Map();for(const[shape,width,height]of [['landscape',1600,400],['square',800,800],['portrait',200,2000]])assets.set(shape,await sharp({create:{width,height,channels:3,background:'#497b89'}}).png().toBuffer());
  let slowReleased=true;const slowResponses=[];
  const release=value=>{slowReleased=value;if(value){for(const pending of slowResponses)pending.end(assets.get('landscape'));slowResponses.length=0;}};
  const httpUnexpected=[];
  server=createServer((request,response)=>{
   if(!fixtureRequestAllowed(request.method,request.url)){httpUnexpected.push('UNEXPECTED_HTTP_REQUEST');response.writeHead(405);response.end();return;}
   const url=new URL(request.url,'http://qa160.invalid');
   if(url.pathname.startsWith('/api/files/')){
    const shape=url.pathname.replace('/api/files/qa160-natural-','');if(shape==='broken'){response.writeHead(404);response.end();return;}
    response.setHeader('content-type','image/png');response.setHeader('cache-control','public,max-age=3600');
    if(shape==='slow'&&!slowReleased)slowResponses.push(response);else response.end(assets.get(shape==='slow'||shape==='fullscreen'?'landscape':shape)??IMAGE);return;
   }
   if(url.pathname==='/app.css'){response.setHeader('content-type','text/css');response.end(css);return;}
   if(url.pathname.startsWith('/bundles/')){response.setHeader('content-type','text/javascript');response.end(fixtures[url.pathname.split('/').at(-1).slice(0,-3)].bytes);return;}
   response.setHeader('content-type','text/html');
   response.end('<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/bundles/'+url.searchParams.get('variant')+'.js"></script></body></html>');
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port,checks=[],mutants=[];
  for(const variant of ['baseline','formatting'])for(const scope of ['project','global'])checks.push(await runBoardPage(browser,origin,scope,variant,expect,variant==='baseline'));
  for(const variant of ['cover-disabled','wrong-product'])for(const scope of ['project','global']){
   let error;try{await runBoardPage(browser,origin,scope,variant,expect,false);}catch(value){error=value;}
   assert.ok(error instanceof CardBrowserFailure,'MUTANT_MUST_FAIL_USER_ACTION');
   assert.equal(error.code,variant==='cover-disabled'?'NAVIGATION_MISSING':'TARGET_MISMATCH');assert.equal(error.phase,'click-navigation');
   assert.equal(error.evidence.ready,true);assert.equal(error.evidence.trusted,true);
   mutants.push({variant,scope,killed:true,code:error.code,phase:error.phase,provenanceAccepted:true,ready:true,trusted:true});
  }
  const numbers=await mobileNumbers(browser,origin,expect),natural=await naturalImages(browser,origin,expect,release);assert.deepEqual(httpUnexpected,[]);
  for(const variant of VARIANTS)for(const[file,expected]of fixtures[variant].files)assert.equal(sha(await readFile(file)),expected,'INPUT_CHANGED_DURING_RUN');
  assert.equal(sha(await readFile(path.join(SOURCE,'app/globals.css'))),sha(cssSource),'CSS_CHANGED_DURING_RUN');
  for(const[file,expected]of configuration)assert.equal(sha(await readFile(file)),expected,'CONFIGURATION_CHANGED_DURING_RUN');assert.equal(sha(await readFile(fileURLToPath(import.meta.url))),producerBefore,'PRODUCER_CHANGED_DURING_RUN');
  const provenance=[];for(const variant of VARIANTS){const fixture=fixtures[variant];const manifest={variant,bundleSha256:fixture.bundleSha256,metafileSha256:sha(JSON.stringify(fixture.metafile)),transforms:fixture.transforms,
   configuration:[...configuration].map(([file,sha256])=>({file:path.relative(ROOT,file).split(path.sep).join('/') ,sha256})),inputs:[...fixture.files].map(([file,sha256])=>({file:path.relative(ROOT,file).split(path.sep).join('/'),sha256}))};
   await writeFile(path.join(directory,variant+'.provenance.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
   await writeFile(path.join(directory,variant+'.metafile.json'),JSON.stringify(fixture.metafile,null,2)+'\n',{flag:'wx'});provenance.push(manifest);
  }
  receipt={status:'COMPONENT_RUNTIME_PASS',scope:'real-client-components-synthetic-transport',stagingStatus:'NOT_RUN',browser:browser.version(),react:require('react/package.json').version,playwright:require('@playwright/test/package.json').version,
   producerSha256:sha(await readFile(fileURLToPath(import.meta.url))),checks,mutants,numbers,natural,sourceUnchanged:true,fullAppACL:'NOT_PROVEN',directory,provenance:provenance.map(p=>({variant:p.variant,bundleSha256:p.bundleSha256,metafileSha256:p.metafileSha256,inputs:p.inputs.length}))};
 }catch(error){hasFailure=true;failure=error;}
 const cleanupErrors=await closeOwned(browser,server);
 if(cleanupErrors.length)throw new AggregateError(hasFailure?[failure,...cleanupErrors]:cleanupErrors,'OWN_BROWSER_SERVER_CLEANUP_FAILED');
 if(hasFailure)throw failure;
 receipt.cleanup={browserClosed:true,serverClosed:true};
 await writeFile(path.join(receipt.directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 return receipt;
}
