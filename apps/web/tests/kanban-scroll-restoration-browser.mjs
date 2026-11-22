import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsx/package.json'))('esbuild');
// Реальные Views/канбаны/CSS. Только сервер и Next transport заменены;
// история браузера сохраняется, содержимое маршрута действительно размонтируется.
const entry = `
import React from 'react';import {createRoot} from 'react-dom/client';
import {ProjectsView} from '@/app/(app)/projects/projects-view';
import {ProductsView} from '@/app/(app)/products/products-view';
import {ProductsTab} from '@/app/(app)/projects/[id]/products-tab';
import {ProjectTabs} from '@/components/project-tabs';
import {TabsContent,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {resolveProductReturn,resolveProjectTab} from '@/lib/product-return-navigation';
import {ListParamsProvider} from '@/lib/list-params';
import {encodeListPreference,normalizeListQuery} from '@/lib/list-state';
const section=location.pathname.split('/')[1],product=section==='products';
const projectFixture=location.pathname.startsWith('/projects/');
const base={title:'Карточка',stage:'IN_WORK',status:'INSTALLATION',stageChangedAt:'2026-10-01',statusChangedAt:'2026-10-01',
 expectedPrice:null,totalPrice:null,quantity:1,currency:'BYN',clientId:'client',clientName:'Клиент',managerName:null,
 projectId:'parent',projectStage:'IN_WORK',projectNumber:'199',projectTitle:'Заказ',engineerId:null,engineerName:null,
 isEngineeringParticipant:false,hasB3d:false,noModel:true,sketchFile:null,coverFile:null,hasMaterialShortage:false,tasksCount:0,filesCount:0,productsCount:1};
const cover={id:'qa212-cover',fileName:'cover.png',mimeType:'image/png',hasThumb:true};
const number=product?'199.5':'199';
window.__rows=[...Array.from({length:24},(_,i)=>({...base,id:'row-'+i,number:number+String(i+1),title:'Карточка '+i})),
 {...base,id:'target',number,title:'Возврат к этой карточке',sketchFile:cover,coverFile:cover},
 ...(projectFixture?Array.from({length:12},(_,i)=>({...base,id:'later-'+i,number:number+'-'+i,title:'Следующее изделие '+i})):[]),
 {...base,id:'first',number:'100',stage:'LEAD',status:'PREPARATION'},
 {...base,id:'last',number:'900',stage:'REFUSED',status:'DONE'}];
window.__user='qa212-user';window.__hold=false;window.__errors=[];
function App(){const [route,setRoute]=React.useState(location.pathname+location.search),[revision,refresh]=React.useState(0);
 const restoredFromHistory=React.useRef(false);
 window.__refresh=()=>refresh(v=>v+1);
 window.__navigate=href=>{restoredFromHistory.current=false;history.pushState({},'',href);setRoute(href);window.scrollTo(0,0)};
 React.useEffect(()=>{const back=()=>{restoredFromHistory.current=true;setRoute(location.pathname+location.search);window.scrollTo(0,0)};window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back)},[]);
 const url=new URL(route,location.origin),query=normalizeListQuery(section,url.search.slice(1)),q=new URLSearchParams(query).get('q')||'';
 if(projectFixture){
  if(url.pathname.startsWith('/products/')){
   const destination=resolveProductReturn(url.searchParams.get('returnTo'),'parent');
   return <main><h1>Изделие проекта</h1><a href={destination.href} onClick={e=>{e.preventDefault();window.__navigate(destination.href)}}>{destination.label}</a></main>;
  }
  // Next может повторно использовать серверную вкладку из записи до replaceState.
  const projectId=url.pathname.split('/')[2],tab=restoredFromHistory.current&&url.searchParams.has('returnTo')?'overview':resolveProjectTab(url.searchParams.get('tab'),['overview','products']);
  return <main key={projectId} style={{padding:16,marginLeft:innerWidth>=768?240:0}}>
   <ProjectTabs initialTab={tab}><TabsList><TabsTrigger value='overview'>Общее</TabsTrigger><TabsTrigger value='products'>Изделия</TabsTrigger></TabsList>
   <TabsContent value='overview'>Общее о проекте</TabsContent>
   <TabsContent value='products'><ProductsTab projectId={projectId} projectStage='IN_WORK' currency='BYN' initialProducts={window.__rows}
    canManage actorRoles={['ADMIN']} actorUserId={window.__user} showAmount={false} engineerOptions={[]}/></TabsContent>
   </ProjectTabs><div style={{height:1200}} data-revision={revision}/>
  </main>;
 }
 const rows=window.__rows.filter(r=>!q||r.number.includes(q)).map(r=>({...r}));
 const isBoard=url.pathname==='/'+section;window.__query=query;
 if(!isBoard)return <main><h1>Карточка</h1><a href={url.searchParams.get('returnTo')||'/'+section+'?view=kanban'} onClick={e=>{e.preventDefault();window.__navigate(e.currentTarget.getAttribute('href'))}}>Назад к доске</a><button onClick={()=>window.__navigate('/'+section+'?view=kanban')}>Меню раздела</button></main>;
 return <main style={{padding:16,marginLeft:innerWidth>768?240:0}}><ListParamsProvider key={window.__user} section={section} initialQuery={query} preference={window.__holdSave?null:encodeListPreference(section,query,'qa212')}>
 {product?<ProductsView view='kanban' resolvedQuery={window.__hold?'view=table':query} products={rows} total={rows.length} page={1} pageSize={10} canManage actorRoles={['ADMIN']} actorUserId={window.__user} showAmount={false} projectOptions={[]} clientOptions={[]} engineerOptions={[]}/>
 :<ProjectsView view='kanban' resolvedQuery={window.__hold?'view=table':query} projects={rows} total={rows.length} page={1} pageSize={10} canManage actorRoles={['ADMIN']} actorUserId={window.__user} showAmount={false} clients={[]} managers={[]} engineers={[]}/>}
 </ListParamsProvider><div style={{height:1200}} data-revision={revision}/></main>;
}createRoot(document.getElementById('root')).render(<App/>);
`;
const boundaries = {
  'next/navigation': "export const useRouter=()=>({push:href=>window.__navigate(href),replace:href=>window.__navigate(href),refresh:()=>window.__refresh()});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);",
  'next/link': "import React from 'react';export default function Link({children,...props}){return <a {...props} onClick={e=>{e.preventDefault();window.__navigate(String(props.href))}}>{children}</a>}",
  '@/server/list-preferences-actions': "import {encodeListPreference} from '@/lib/list-state';export async function saveListPreference(section,query){if(window.__holdSave)await new Promise(resolve=>window.__releaseSave=resolve);return {ok:true,value:encodeListPreference(section,query,'qa212')}}",
  '@/server/projects/stage-actions': "export async function patchProjectStage(){throw Error('UNEXPECTED_WRITE')}",
  '@/server/products/actions': "export async function changeProductStatus(){throw Error('UNEXPECTED_WRITE')}export async function createProduct(){throw Error('UNEXPECTED_WRITE')}",
  '@/server/projects/actions': "export async function createProject(){throw Error('UNEXPECTED_WRITE')}",
  '@/server/clients/actions': "export async function clientSelectionOptions(){return []}export async function createClient(){throw Error('UNEXPECTED_WRITE')}",
};

export async function runScrollRestorationBrowser({ smoke = false } = {}) {
  const directory = path.resolve(web, '../../.playwright-mcp/task-212/components');
  await mkdir(directory, { recursive: true });
  const bundle = await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: web }, bundle: true, write: false,
    platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: path.join(web, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'qa212-boundaries', setup(builder) {
      builder.onResolve({ filter: /^(?:next\/|@\/server\/)/ }, args => {
        assert.ok(Object.hasOwn(boundaries, args.path), 'Unexpected server import: ' + args.path);
        return { path: args.path, namespace: 'boundary' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'boundary' }, args => ({ contents: boundaries[args.path], loader: 'tsx', resolveDir: web }));
    } }] });
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const css = (await postcss([require('@tailwindcss/postcss')({ base: web })]).process(await readFile(path.join(web, 'src/app/globals.css'), 'utf8'), { from: path.join(web, 'src/app/globals.css') })).css;
  const server = createServer((request, response) => {
    assert.equal(request.method, 'GET', 'Fixture must not write');
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/api/files/qa212-cover') {
      response.setHeader('content-type', 'image/png');
      response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwb3/5HwAFhwK3tfHguAAAAABJRU5ErkJggg==', 'base64'));return;
    }
    response.setHeader('content-type', pathname === '/app.js' ? 'text/javascript' : pathname === '/app.css' ? 'text/css' : 'text/html');
    response.end(pathname === '/app.js' ? bundle.outputFiles[0].text : pathname === '/app.css' ? css : '<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const checks = [], errors = [], screenshots = [];
  const measure = page => page.evaluate(() => {
    const board = document.querySelector('[data-slot="kanban-scroll"]');
    const card = board?.querySelector('[data-kanban-card-id="target"], [data-slot="product-kanban-card"][data-has-image="true"]');
    const rect = card?.getBoundingClientRect();
    return { left: board?.scrollLeft, top: scrollY, bottom: document.querySelector('[data-kanban-scrollbar]')?.scrollLeft, x: rect?.x, y: rect?.y };
  });
  const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  async function arrange(page, project = false, useScrollbar = false) {
    const target = project ? '[data-slot="product-kanban-card"][data-has-image="true"]' : '[data-kanban-card-id="target"]';
    await page.locator(target).waitFor();
    await page.evaluate(({ selector, useScrollbar }) => {
      const board = document.querySelector('[data-slot="kanban-scroll"]'), card = board.querySelector(selector);
      board.style.scrollSnapType = 'none';
      const b = board.getBoundingClientRect(), r = card.getBoundingClientRect();
      const horizontal = useScrollbar ? document.querySelector('[data-kanban-scrollbar]') : board;
      horizontal.scrollLeft = board.scrollLeft + r.left - b.left - 25;
      window.scrollTo(0, scrollY + r.top - 110);
    }, { selector: target, useScrollbar });
    await settle(page);
    const before = await measure(page);
    assert.ok(before.left > 100 && before.top > 100, 'Both axes must be nonzero');
    return before;
  }
  async function returned(page, before, label) {
    await page.locator('[data-kanban-card-id="target"]').waitFor();
    await expect.poll(async () => {
      const after = await measure(page);
      return Math.max(...['left', 'top', 'x', 'y'].map(key => Math.abs(after[key] - before[key])), Math.abs(after.left - (after.bottom ?? Infinity)));
    }, { message: label, timeout: 4000 }).toBeLessThanOrEqual(2);
    checks.push(label);
  }
  try {
    for (const viewport of smoke ? [{ width: 1440, height: 900 }] : [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 800 }]) {
      const page = await browser.newPage({ viewport, hasTouch: viewport.width < 768, isMobile: viewport.width < 768 });
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/projects/parent?returnTo=%2Fprojects%3Fview%3Dkanban');
      await page.getByRole('tab', { name: 'Изделия' }).click();
      const card = page.locator('[data-slot="product-kanban-card"][data-has-image="true"]');
      const before = await arrange(page, true);
      await card.getByText('Возврат к этой карточке').click();
      await page.getByRole('heading', { name: 'Изделие проекта' }).waitFor();
      await page.goBack();
      await expect(page.getByRole('tab', { name: 'Изделия' })).toHaveAttribute('aria-selected', 'true');
      assert.equal(new URL(page.url()).searchParams.get('returnTo'), '/projects?view=kanban');
      assert.equal(new URL(page.url()).searchParams.get('tab'), 'products');
      assert.ok(Number.isFinite(before.bottom), 'The sticky scrollbar must be present');
      await returned(page, before, 'project-products/' + viewport.width + '/back-from-body');

      await page.evaluate(() => { document.querySelector('[data-kanban-scrollbar]').scrollLeft = 0; });
      await settle(page);
      const coverBefore = await arrange(page, true, true);
      await card.getByRole('button', { name: 'Открыть изделие Возврат к этой карточке' }).click();
      await page.getByRole('link', { name: 'Назад к изделиям проекта' }).click();
      await expect(page).toHaveURL(origin + '/projects/parent?tab=products&returnTo=%2Fprojects%3Fview%3Dkanban');
      await returned(page, coverBefore, 'project-products/' + viewport.width + '/link-from-cover');
      if (!smoke) {
        const screenshot = path.join(directory, 'project-products-' + viewport.width + '.png');
        await page.screenshot({ path: screenshot });
        screenshots.push(screenshot);
      }
      if (viewport.width === 1440) {
        const inspectOtherBoard = async href => {
          await page.evaluate(destination => window.__navigate(destination), href);
          await page.locator('[data-kanban-scrollbar]').waitFor();
          await settle(page);
          const position = await measure(page);
          assert.equal(position.left, 0);
          assert.equal(position.top, 0);
        };
        await inspectOtherBoard('/projects/second?tab=products');
        await page.evaluate(() => { window.__user = 'another-user'; });
        await inspectOtherBoard('/projects/parent?tab=products');
        await page.evaluate(() => { window.__user = 'qa212-user'; window.__refresh(); });
        await returned(page, coverBefore, 'project-products/isolation');
        const anchorBefore = await arrange(page, true);
        await card.getByText('Возврат к этой карточке').click();
        await page.getByRole('heading', { name: 'Изделие проекта' }).waitFor();
        await page.evaluate(() => {
          window.__rows.unshift({ ...window.__rows[0], id: 'inserted-before-target' });
        });
        await page.goBack();
        await card.waitFor();
        await expect.poll(async () => Math.abs((await measure(page)).y - anchorBefore.y)).toBeLessThanOrEqual(2);
        assert.ok((await measure(page)).top > anchorBefore.top, 'A shifted card adjusts the vertical position');
        checks.push('project-products/moved-anchor');

        const missingBefore = await arrange(page, true);
        await card.getByText('Возврат к этой карточке').click();
        await page.getByRole('heading', { name: 'Изделие проекта' }).waitFor();
        await page.evaluate(() => { window.__rows = window.__rows.filter(row => row.id !== 'target'); });
        await page.goBack();
        await page.locator('[data-kanban-scrollbar]').waitFor();
        await expect.poll(async () => {
          const after = await measure(page);
          return Math.max(Math.abs(after.left - missingBefore.left), Math.abs(after.top - missingBefore.top), Math.abs(after.left - after.bottom));
        }).toBeLessThanOrEqual(2);
        checks.push('project-products/missing-anchor');
      }
      await page.context().close();
    }
    for (const section of ['projects', 'products']) for (const viewport of smoke ? [{ width: 1440, height: 900 }] : [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 800 }]) {
      const context = await browser.newContext({ viewport }), page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/' + section + '?view=kanban');
      for (const mode of smoke ? ['back'] : ['back', 'link', 'menu']) {
        const before = await arrange(page);
        await page.locator('[data-kanban-card-id="target"]').getByText('Возврат к этой карточке').click();
        await page.getByRole('heading', { name: 'Карточка', exact: true }).waitFor();
        if (mode === 'back') await page.goBack();
        else await page.getByText(mode === 'link' ? 'Назад к доске' : 'Меню раздела', { exact: true }).click();
        await returned(page, before, section + '/' + viewport.width + '/' + mode);
      }
      if (!smoke) {
        const saved = await arrange(page);
        const screenshot = path.join(directory, section + '-' + viewport.width + '.png');
        await page.screenshot({ path: screenshot });screenshots.push(screenshot);
        await page.evaluate(() => window.__refresh());await settle(page);
        await returned(page, saved, section + '/' + viewport.width + '/refresh');
        if (viewport.width === 1440) {
          const open = async () => {
            await page.locator('[data-kanban-card-id="target"]').getByText('Возврат к этой карточке').click();
            await page.getByRole('heading', { name: 'Карточка', exact: true }).waitFor();
          };
          let before = await arrange(page);
          await page.locator('[data-kanban-card-id="target"] button').filter({ hasNotText: 'Перетащить' }).last().click();
          await page.getByRole('heading', { name: 'Карточка', exact: true }).waitFor();
          await page.goBack();await returned(page, before, section + '/cover');

          before = await arrange(page);await open();
          await page.evaluate(() => { window.__hold = true; });
          await page.goBack();await page.locator('[data-slot="kanban-scroll"]').waitFor();await settle(page);
          assert.equal((await measure(page)).left, 0, 'Unconfirmed rows must not restore');
          await page.evaluate(() => { window.__hold = false; window.__refresh(); });
          await returned(page, before, section + '/delayed-rows');

          await open();await page.evaluate(() => { window.__hold = true; });await page.goBack();
          await page.locator('[data-slot="kanban-scroll"]').waitFor();await settle(page);
          await page.mouse.move(700, 300);await page.mouse.wheel(0, 140);await settle(page);
          const manual = await measure(page);
          await page.evaluate(() => { window.__hold = false; window.__refresh(); });await settle(page);
          await returned(page, manual, section + '/manual-cancels-pending');

          await arrange(page);await open();await page.setViewportSize({ width: 390, height: 844 });await page.goBack();
          await page.locator('[data-kanban-card-id="target"]').waitFor();
          await expect.poll(() => page.locator('[data-kanban-card-id="target"]').evaluate(card => {
            const r = card.getBoundingClientRect();return r.left >= 0 && r.right <= innerWidth + 2 && r.top >= 0 && r.top < innerHeight;
          })).toBe(true);
          checks.push(section + '/resize-in-detail');
          await page.setViewportSize(viewport);await page.evaluate(() => window.__refresh());await settle(page);

          before = await arrange(page);await open();
          await page.evaluate(() => { const row = window.__rows.find(r => r.id === 'target'); window.__target = { ...row }; row.stage = 'LEAD'; row.status = 'PREPARATION'; });
          await page.goBack();await page.locator('[data-kanban-card-id="target"]').waitFor();
          await expect.poll(async () => { const p = await measure(page); return p.x >= 0 && p.x < 1440 && p.y >= 0 && p.y < 900; }).toBe(true);
          checks.push(section + '/moved-card');
          await open();await page.evaluate(() => { window.__rows = window.__rows.filter(r => r.id !== 'target'); });await page.goBack();
          await page.locator('[data-slot="kanban-scroll"]').waitFor();await settle(page);
          assert.equal(await page.locator('[data-kanban-card-id="target"]').count(), 0);
          const fallback = await measure(page);assert.ok(Number.isFinite(fallback.left) && Number.isFinite(fallback.top));
          await page.evaluate(() => { scrollBy(0, 100); window.__refresh(); });await settle(page);
          checks.push(section + '/missing-card');

          const number = section === 'projects' ? '199' : '199.5';
          await page.goto(origin + '/' + section + '?view=kanban&q=' + number);
          async function centered() {
            await expect.poll(() => page.locator('[data-kanban-card-id="target"]').evaluate(card => {
              const b = card.closest('[data-slot="kanban-scroll"]'), r = card.getBoundingClientRect(), bounds = b.getBoundingClientRect();
              const limit = (v, max) => Math.max(0, Math.min(v, max));
              const x = limit(b.scrollLeft + r.x + r.width / 2 - (Math.max(0, bounds.left) + Math.min(innerWidth, bounds.right)) / 2, b.scrollWidth - b.clientWidth);
              const y = limit(scrollY + r.y + r.height / 2 - innerHeight / 2, document.scrollingElement.scrollHeight - innerHeight);
              return Math.max(Math.abs(x - b.scrollLeft), Math.abs(y - scrollY));
            })).toBeLessThanOrEqual(2);
          }
          await centered();before = await arrange(page);await open();await page.goBack();
          await returned(page, before, section + '/return-does-not-repeat-search');
          await page.getByPlaceholder('Введите номер').fill('');
          await expect.poll(() => page.evaluate(() => window.__query)).toBe('view=kanban');
          await page.getByPlaceholder('Введите номер').fill(number);await centered();
          checks.push(section + '/clear-reenter-centers');

          await page.goto(origin + '/' + section + '?view=kanban');
          await page.locator('[data-slot="kanban-scroll"]').waitFor();
          await page.evaluate(() => { window.__holdSave = true; window.__user = 'new-user'; window.__refresh(); });await settle(page);
          assert.equal((await measure(page)).left, 0, 'Another user must not inherit the position');
          before = await arrange(page);await open();await page.goBack();
          await returned(page, before, section + '/pending-preference-save');

          await page.evaluate(() => { window.__holdSave = false; window.__user = 'qa212-user'; window.__refresh(); });
          before = await arrange(page);

          const other = await context.newPage();await other.goto(origin + '/' + section + '?view=kanban');
          let otherBefore = await arrange(other);
          await other.evaluate(() => { const b = document.querySelector('[data-slot="kanban-scroll"]'); b.scrollLeft -= 37; scrollBy(0, -51); });await settle(other);otherBefore = await measure(other);
          await other.locator('[data-kanban-card-id="target"]').getByText('Возврат к этой карточке').click();
          await other.getByRole('heading', { name: 'Карточка', exact: true }).waitFor();
          await open();await page.goBack();await other.goBack();
          await returned(page, before, section + '/tab-one');await returned(other, otherBefore, section + '/tab-two');
          await other.close();
        }
      }
      await context.close();
    }
    assert.deepEqual(errors, [], 'Browser errors');
    const result = { status: 'PASS', checks, screenshots };
    await writeFile(path.join(directory, 'receipt.json'), JSON.stringify(result, null, 2));
    return result;
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runScrollRestorationBrowser({ smoke: process.argv.includes('--smoke') })));
}
