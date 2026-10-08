import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFileSync,readdirSync,mkdirSync} from 'node:fs';import path from 'node:path';
import {chromium,expect} from '@playwright/test';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild'),web=process.cwd(),out=path.resolve('../../.playwright-mcp/finance109');
assert.equal(path.basename(web),'web');mkdirSync(out,{recursive:true});
const preview={movementId:'root',planFingerprint:'a'.repeat(64),materialName:'Топливо',unit:'кг',before:{quantity:'30',value:'3000'},after:{quantity:'0',value:'0'},
 movements:[{id:'root',type:'INCOME',date:'2026-10-08T09:34:01.428Z',quantity:'37',money:'3700',productNumber:null,reason:'ROOT'},
 {id:'issue',type:'EXPENSE',date:'2026-10-08T09:35:00Z',quantity:'7',money:'700',productNumber:'201.1',reason:'STOCK'}],
 refunds:[{cashAccountId:'cash',cashName:'Основная касса',currency:'BYN',amount:'3700',bynAmount:'3700'}],projects:[{id:'project',number:'201',expenseDelta:'-700'}]};
const rows=preview.movements.map(row=>({...row,materialId:'material',materialName:'Топливо',materialUnit:'кг',quantity:Number(row.quantity),totalByn:Number(row.money),unitPrice:100,receiptKind:row.type==='INCOME'?'PAID':null,productId:row.productNumber?'product':null,createdByName:'Снабженец',createdAt:row.date,comment:'QA: ошибочная операция',reportDocument:null}));
const result=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {MovementsView} from '@/app/(app)/warehouse/movements/movements-view';
 function App(){const [canDelete,setCanDelete]=React.useState(true);window.__setCanDelete=setCanDelete;return <MovementsView rows={window.__rows} materials={[]} showMoney canDelete={canDelete}/>;}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:web,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'boundaries',setup(b){
 b.onResolve({filter:/^(next\/navigation|next\/link|sonner|@\/server\/warehouse\/deletion-actions)$/},args=>({path:args.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='next/link'?`import React from 'react';export default function Link(props){return React.createElement('a',props)}`:args.path==='next/navigation'?'export const useRouter=()=>({refresh(){window.__refreshed=true}});':args.path==='sonner'?'export const toast={success(){}};':`export async function previewWarehouseMovementDeletion(){return {ok:true,preview:window.__preview}};export async function deleteWarehouseMovement(input){window.__write=input;return {ok:true}};`,loader:'js',resolveDir:web}));}}],logLevel:'silent'});
const cssDir=path.join(web,'.next/static/css'),css=readdirSync(cssDir).filter(x=>x.endsWith('.css')).map(x=>readFileSync(path.join(cssDir,x),'utf8')).join('\n');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://warehouse.fixture/_next/static/media/*',route=>{const name=path.basename(new URL(route.request().url()).pathname);assert.ok(readdirSync(path.join(web,'.next/static/media')).includes(name));return route.fulfill({contentType:'font/woff2',body:readFileSync(path.join(web,'.next/static/media',name))});});
 const fontVariable=css.match(/--font-roboto:[^;}]+/)?.[0];assert.ok(fontVariable);
 await page.route('http://warehouse.fixture/',route=>route.fulfill({contentType:'text/html',body:'<style>'+css+':root{'+fontVariable+'}</style><main id="root" style="padding:20px"></main>'}));
 await page.goto('http://warehouse.fixture/');await page.evaluate(values=>Object.assign(window,values),{__preview:preview,__rows:rows});await page.addScriptTag({content:result.outputFiles[0].text});
 await page.getByRole('button',{name:'Удалить',exact:true}).first().waitFor();await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.getByRole('row').nth(1).getByRole('cell').last().innerText(),'Удалить');
 await page.getByRole('button',{name:'Удалить',exact:true}).first().click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('listitem')).toHaveCount(2);
 await dialog.screenshot({path:path.join(out,'delete-preview-desktop.png'),animations:'disabled'});
 await dialog.getByRole('button',{name:'Отмена',exact:true}).click();assert.equal(await page.evaluate(()=>window.__write),undefined);
 await page.setViewportSize({width:390,height:844});await expect(page.getByRole('article')).toHaveCount(2);
 await page.screenshot({path:path.join(out,'delete-journal-mobile.png'),animations:'disabled'});
 await page.getByRole('article').first().getByRole('button',{name:'Удалить',exact:true}).click();await expect(dialog.getByRole('listitem')).toHaveCount(2);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.ok(await dialog.evaluate(node=>node.querySelector('[data-slot="dialog-title"]').getBoundingClientRect().top>=node.getBoundingClientRect().top),'PREVIEW_HEADER_CLIPPED');
 await dialog.screenshot({path:path.join(out,'delete-preview-mobile.png'),animations:'disabled'});
 const cancel=dialog.getByRole('button',{name:'Отмена',exact:true});await cancel.scrollIntoViewIfNeeded();await expect(cancel).toBeInViewport();
 const cancelBox=await cancel.boundingBox();assert.ok(cancelBox&&cancelBox.y>=0&&cancelBox.y+cancelBox.height<=844);
 await dialog.screenshot({path:path.join(out,'delete-preview-mobile-footer.png'),animations:'disabled'});
 const submit=dialog.getByRole('button',{name:'Удалить',exact:true});await submit.scrollIntoViewIfNeeded();await expect(submit).toBeInViewport();
 await submit.click();await expect(dialog).toHaveCount(0);assert.equal(await page.evaluate(()=>window.__write.movementId),'root');
 await page.evaluate(()=>window.__setCanDelete(false));await expect(page.getByRole('button',{name:'Удалить',exact:true})).toHaveCount(0);
 assert.deepEqual(errors,[]);console.log('BROWSER109 PASS: actual components/CSS1440/390, last-column/admin/mobile button, full cascade/refund/preview, cancel/confirm; server boundary mocked, no database writes');
}finally{await browser.close();}
