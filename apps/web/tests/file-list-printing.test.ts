import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import sharp from "sharp";
import type { FileListItem } from "../src/lib/viewable-file";

const require = createRequire(import.meta.url), { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files: FileListItem[] = [
  { id: "image", fileName: "Полный_исходный_эскиз_с_длинным_названием_без_сокращения.png", mimeType: "image/png", canDelete: true },
  { id: "pdf", fileName: "Проектный_счёт.pdf", mimeType: "application/pdf", canDelete: true },
  { id: "cad", fileName: "Шкаф.b3d", mimeType: "application/octet-stream", canDelete: true },
  { id: "video", fileName: "Монтаж.mp4", mimeType: "video/mp4", canDelete: true },
  { id: "finance", fileName: "Финансовый_документ.pdf", mimeType: "application/pdf", source: "finance", canDelete: false },
  { id: "finance-image", fileName: "Чек.png", mimeType: "image/png", source: "finance", canDelete: false },
  ...["success", "fail", "throw"].map(id => ({ id, fileName: `${id}.txt`, mimeType: "text/plain", canDelete: true })),
];
type Metrics = { calls: { contentType: string; text: string; image: { width: number; height: number; fit: string } | null }[]; created: string[]; revoked: string[]; rowClicks: number };
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{FileList,FileListRow}from'@/components/file-list';import{ReportDocumentButton}from'@/components/report-document-button';import{ProductMeasurement,ProductDocuments}from'@/components/product-attachments';import{FilesTab}from'@/app/(app)/projects/[id]/files-tab';import{useFileViewer}from'@/components/file-viewer';import*as printer from'@/lib/browser-file-print';
const selected=${JSON.stringify(files.slice(0,4))},productRows=section=>selected.map(file=>({...file,section}));
function ProductFiles(){const productViewer=useFileViewer('fullscreen','red'),defaultViewer=useFileViewer('fullscreen');return <main style={{padding:16,maxWidth:720}}>
<span data-expected-red className="text-red-600 dark:text-red-400">Образец цвета</span><div data-qa-product-groups className="space-y-4"><ProductMeasurement projectId="fixture-project" productId="fixture-product" files={productRows('MEASUREMENT')} canEdit={false}/><ProductDocuments projectId="fixture-project" productId="fixture-product" production={productRows('PRODUCTION')} installation={productRows('INSTALLATION')} noModel canManage={false} canEdit={false}/></div>
<div data-qa-product-files><FilesTab projectId="fixture-project" productId="fixture-product" files={productRows('PRODUCTION')} canEdit={false}/></div><div data-qa-default-files><FilesTab projectId="fixture-project" files={productRows('GENERAL')} canEdit={false}/></div>
<button onClick={()=>productViewer.open(selected[1])}>Предпросмотр изделия</button><button onClick={()=>defaultViewer.open(selected[1])}>Обычный предпросмотр</button>{productViewer.viewer}{defaultViewer.viewer}</main>;}
const root=createRoot(document.getElementById('root'));window.fixture={...printer,product:()=>root.render(<ProductFiles/>),unmount:()=>root.unmount(),render:file=>root.render(<div onClick={()=>window.printMetrics.rowClicks++}>{file.source==='finance'?<ReportDocumentButton document={file}/>:<FileListRow file={file} disabled={file.disabled}/>}</div>)};
window.qa={deleteCalls:[],refreshes:0,busy:[],parentKeys:0};function App(){const[files,setFiles]=React.useState(${JSON.stringify(files)});return <main style={{padding:16,maxWidth:720}} onClick={()=>window.printMetrics.rowClicks++} onKeyDown={()=>window.qa.parentKeys++}><FileList files={files} onBusyChange={busy=>window.qa.busy.push(busy)} onDelete={async file=>{window.qa.deleteCalls.push(file.id);if(file.id==='fail')return{ok:false,error:'Сервер отказал в удалении'};if(file.id==='throw')throw Error('NETWORK');await new Promise(resolve=>window.qa.resolveDelete=resolve);return{ok:true};}} onDeleted={file=>{window.qa.refreshes++;setFiles(rows=>rows.filter(row=>row.id!==file.id));}}/></main>;}root.render(<App/>);`;
let browser: Browser, javascript: string, css: string, pdf: Buffer;
const assets = new Map<string, Buffer>();
before(async () => {
  const boundaries: Record<string,string> = {
    "next/navigation": "export const useRouter=()=>({refresh:()=>window.qa.refreshes++});",
    "@/server/files/actions": "export async function deleteFile(id){window.qa.deleteCalls.push(id);return{ok:true};}",
    "@/components/product-inline-provider": "const registerGuard=()=>()=>{};export const useProductInline=()=>({registerGuard});",
  };
  const compiled = await build({ stdin: { contents: entry, resolveDir: web, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent", plugins:[{
    name:"product-file-transport",setup(builder: {
      onResolve:(options:{filter:RegExp},callback:(args:{path:string})=>{path:string;namespace:string})=>void;
      onLoad:(options:{filter:RegExp;namespace:string},callback:(args:{path:string})=>{contents:string;loader:"tsx";resolveDir:string})=>void;
    }){
      builder.onResolve({filter:/^(?:next\/navigation|@\/server\/files\/actions|@\/components\/product-inline-provider)$/},args=>({path:args.path,namespace:"fixture-boundary"}));
      builder.onLoad({filter:/.*/,namespace:"fixture-boundary"},args=>({contents:boundaries[args.path],loader:"tsx",resolveDir:web}));
    },
  }] });
  javascript = compiled.outputFiles[0].text;
  const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss"), tailwind = require("@tailwindcss/postcss");
  css = (await postcss([tailwind({ base: web })]).process(await readFile(path.join(web, "src/app/globals.css"), "utf8"), { from: path.join(web, "src/app/globals.css") })).css;
  for (const [id, width, height] of [["image", 1200, 300], ["tall", 300, 1200], ["square", 500, 500]] as const) assets.set(id, await sharp({ create: { width, height, channels: 3, background: "#497b89" } }).png().toBuffer());
  const stream = "BT /F1 24 Tf 72 720 Td (SELECTED ORIGINAL PDF) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text = "%PDF-1.4\n"; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(text); text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf = Buffer.from(text + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  browser = await chromium.launch({ headless: true, channel: "chromium" });
});
after(async () => { await browser?.close(); });

async function withFiles(viewport: { width: number; height: number }, operation: (page: Page, requests: string[], release: () => void) => Promise<void>) {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce", acceptDownloads: true }), requests: string[] = [];
  let release = () => {}; const slow = new Promise<void>(resolve => { release = resolve; });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://127.0.0.1");
    if (request.method !== "GET") { response.writeHead(405); response.end(); return; }
    if (url.pathname === "/files-component") { response.setHeader("content-type", "text/html"); response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><h1>CRM_CHROME_MUST_NOT_PRINT</h1><div id="root"></div>'); return; }
    if (url.pathname === "/login") { response.setHeader("content-type", "text/html"); response.end("<html>Login page</html>"); return; }
    if (!/^\/api\/(files|finance\/documents)\/[a-z-]+$/.test(url.pathname)) { response.writeHead(404); response.end(); return; }
    requests.push(url.pathname + url.search); assert.match(request.headers.cookie ?? "", /fixture=allowed/);
    const id = url.pathname.split("/").at(-1)!, selected = files.find(file => file.id === id);
    if (id === "slow") await slow;
    if (response.destroyed) return;
    if (id === "denied") { response.writeHead(403, { "content-type": "application/json" }); response.end('{"error":"Недоступно"}'); return; }
    if (id === "login") { response.setHeader("content-type", "text/html"); response.end("<html>Login page</html>"); return; }
    if (id === "redirect") { response.writeHead(302, { location: "/login" }); response.end(); return; }
    if (id === "svg") { response.setHeader("content-type", "image/svg+xml"); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>parent.svgExecuted=true</script><rect width="100" height="100" fill="green"/></svg>'); return; }
    const mimeType = selected?.mimeType ?? (id === "broken-pdf" ? "application/pdf" : "image/png");
    const body = id === "bad-image" ? Buffer.from("broken PNG") : id === "broken-pdf" ? Buffer.from("%PDF-1.7\nbroken") : mimeType === "application/pdf" ? pdf : mimeType.startsWith("image/") ? assets.get(id === "slow" || id === "finance-image" ? "image" : id)! : Buffer.from(`ORIGINAL ${id}`);
    assert.ok(body, "UNDECLARED_FILE_FIXTURE");
    response.setHeader("content-type", mimeType); response.setHeader("content-disposition", `${url.searchParams.get("view") === "1" || mimeType.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(selected?.fileName ?? `${id}.png`)}`);
    response.end(body);
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await context.addCookies([{ name: "fixture", value: "allowed", url: origin }]);
    await context.addInitScript(`window.printMetrics={calls:[],created:[],revoked:[],rowClicks:0};if(window.top===window){const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);window.printMetrics.created.push(url);return url;};URL.revokeObjectURL=url=>{window.printMetrics.revoked.push(url);revoke(url);};}window.print=()=>{const image=document.querySelector('img'),metrics=window.parent.printMetrics;metrics.calls.push({contentType:document.contentType,text:document.body.textContent,image:image?{width:image.naturalWidth,height:image.naturalHeight,fit:getComputedStyle(image).objectFit}:null});if(window.parent.autoAfterPrint!==false)queueMicrotask(()=>dispatchEvent(new Event('afterprint')));};`);
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin || request.method() !== "GET" || !["/files-component", "/login"].includes(url.pathname) && !/^\/api\/(files|finance\/documents)\/[a-z-]+$/.test(url.pathname)) return route.abort("blockedbyclient");
      await route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    await page.goto(origin + "/files-component"); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: javascript });
    await page.locator('[data-file-list-row="image"]').waitFor(); await operation(page, requests, release);
  } finally { release(); await context.close(); server.closeAllConnections(); if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("real file rows preserve names, protected downloads, permissions and transactional confirmation", async () => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 800 }]) await withFiles(viewport, async page => {
    const row = (id: string) => page.locator(`[data-file-list-row="${id}"]`), popup = page.locator('[data-slot="popover-content"]');
    assert.equal(await page.locator("img,video,iframe").count(), 0); assert.equal(await row("image").innerText(), files[0].fileName);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await row("finance").getByRole("button", { name: /^Удалить файл/ }).isDisabled(), true);
    assert.equal(await row("finance").getByRole("button", { name: /^Распечатать/ }).isDisabled(), false);
    for (const id of ["pdf", "cad", "video", "finance"]) {
      const selected = files.find(file => file.id === id)!, download = page.waitForEvent("download");
      await row(id).getByRole("link").focus(); await page.keyboard.press("Enter"); const original = await download;
      assert.equal(original.suggestedFilename(), selected.fileName); assert.equal(original.url(), `${new URL(page.url()).origin}/api/${selected.source === "finance" ? "finance/documents" : "files"}/${id}`);
      const stream = await original.createReadStream(); assert.ok(stream); const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(chunk);
      assert.deepEqual(Buffer.concat(chunks), selected.mimeType === "application/pdf" ? pdf : Buffer.from(`ORIGINAL ${id}`));
      assert.equal(await row(id).getByRole("button", { name: /^Распечатать/ }).count(), selected.mimeType === "application/pdf" ? 1 : 0);
    }
    for (const id of ["image", "finance-image"]) {
      await row(id).getByRole("button", { name: files.find(file => file.id === id)!.fileName, exact: true }).focus(); await page.keyboard.press("Enter");
      const image = page.locator('[data-fullscreen-image] img'); await expect(image).toBeVisible(); await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(1200);
      assert.equal(await image.getAttribute("src"), `/api/${id === "finance-image" ? "finance/documents" : "files"}/${id}`); assert.equal(await image.evaluate(node => getComputedStyle(node).objectFit), "contain");
      await expect.poll(() => page.locator('[data-file-viewer-variant="image-fullscreen"]').evaluate(node => Math.round(node.getBoundingClientRect().width))).toBe(viewport.width);
      await page.getByRole("button", { name: "Закрыть полноэкранный просмотр" }).click(); await expect(image).toHaveCount(0);
    }
    const trash = row("success").getByRole("button", { name: /^Удалить файл/ }); await trash.focus(); await page.keyboard.press("Enter");
    await expect(popup.getByRole("button", { name: "Отмена", exact: true })).toBeFocused(); await page.keyboard.press("Escape"); await expect(popup).toHaveCount(0);
    await trash.click(); await popup.getByRole("button", { name: "Отмена", exact: true }).click(); await expect(popup).toHaveCount(0); assert.deepEqual(await page.evaluate("window.qa.deleteCalls"), []);
    await trash.click(); await popup.getByRole("button", { name: "Удалить", exact: true }).evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
    await expect(popup.getByRole("button", { name: "Удаление…", exact: true })).toBeDisabled(); await expect(popup.getByRole("button", { name: "Отмена", exact: true })).toBeDisabled();
    await expect(row("pdf").getByRole("button", { name: /^Удалить файл/ })).toBeDisabled(); await page.keyboard.press("Escape"); await page.mouse.click(2, 2); await expect(popup).toBeVisible();
    assert.deepEqual(await page.evaluate("window.qa.deleteCalls"), ["success"]); await page.evaluate("window.qa.resolveDelete()"); await expect(row("success")).toHaveCount(0); await expect(popup).toHaveCount(0);
    assert.equal(await page.evaluate("window.qa.refreshes"), 1); assert.deepEqual(await page.evaluate("window.qa.busy"), [true, false]);
    for (const [id, message] of [["fail", "Сервер отказал в удалении"], ["throw", "Не удалось подтвердить удаление. Повторите попытку."]]) {
      await row(id).getByRole("button", { name: /^Удалить файл/ }).click(); await popup.getByRole("button", { name: "Удалить", exact: true }).click(); await expect(popup.getByRole("alert")).toHaveText(message);
      await expect(row(id)).toBeVisible(); await popup.getByRole("button", { name: "Отмена", exact: true }).click(); await expect(popup).toHaveCount(0);
    }
    assert.equal(await page.evaluate("window.printMetrics.rowClicks"), 0); assert.equal(await page.evaluate("window.qa.parentKeys"), 0);
  });
});

test("product filenames stay red through groups and viewer portal while default files and actions are preserved", async () => {
  const directory=path.join(web,"test-results/product-file-name-color",randomUUID()),checks: {width:number;theme:string;screenshots:string[]}[]=[];
  await mkdir(directory,{recursive:true});
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:360,height:800}])await withFiles(viewport,async page=>{
    await page.evaluate("window.fixture.product()");
    const groups=page.locator('[data-qa-product-groups]'),legacy=page.locator('[data-qa-product-files]'),defaults=page.locator('[data-qa-default-files]');
    await expect(groups.locator('[data-file-list-row]')).toHaveCount(12);
    for(const theme of ['light','dark']){
      await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark');
      const red=await page.locator('[data-expected-red]').evaluate(node=>getComputedStyle(node).color);
      for(const container of [groups,legacy])for(const name of await container.locator('[data-file-list-row] > :is(button,a):first-child').all()){
        assert.equal(await name.evaluate(node=>getComputedStyle(node).color),red,'PRODUCT_FILENAME_RED_REQUIRED');
        assert.equal(await name.evaluate(node=>node.scrollWidth<=node.clientWidth),true,'FILENAME_OVERFLOW');
      }
      const normalName=defaults.locator('[data-file-list-row="image"] > button:first-child');
      assert.notEqual(await normalName.evaluate(node=>getComputedStyle(node).color),red,'DEFAULT_FILENAME_MUST_KEEP_STYLE');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      const screenshots=[path.join(directory,`groups-${viewport.width}-${theme}.png`)];await page.screenshot({path:screenshots[0],fullPage:true,animations:'disabled'});
      await page.getByRole('button',{name:'Предпросмотр изделия',exact:true}).click();
      const dialog=page.getByRole('dialog'),name=dialog.locator('span.truncate');
      await expect(name).toHaveText(files[1].fileName);assert.equal(await name.evaluate(node=>getComputedStyle(node).color),red,'VIEWER_FILENAME_RED_REQUIRED');
      assert.equal(await name.evaluate(node=>node.closest('[data-qa-product-groups]')===null),true,'VIEWER_MUST_USE_PORTAL');
      screenshots.push(path.join(directory,`viewer-${viewport.width}-${theme}.png`));await page.screenshot({path:screenshots[1],animations:'disabled'});
      const download=page.waitForEvent('download');await dialog.getByRole('link').click();assert.equal((await download).suggestedFilename(),files[1].fileName);
      await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
      await page.getByRole('button',{name:'Обычный предпросмотр',exact:true}).click();
      assert.notEqual(await page.getByRole('dialog').locator('span.truncate').evaluate(node=>getComputedStyle(node).color),red);
      await page.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
      checks.push({width:viewport.width,theme,screenshots});
    }
    const measurement=groups.getByRole('region',{name:'Замер',exact:true}),imageName=measurement.getByRole('button',{name:files[0].fileName,exact:true});
    await imageName.focus();await page.keyboard.press('Enter');const image=page.locator('[data-fullscreen-image] img');
    await expect(image).toBeVisible();await expect.poll(()=>image.evaluate(node=>(node as HTMLImageElement).naturalWidth)).toBe(1200);
    assert.equal(await image.getAttribute('src'),'/api/files/image');assert.equal(await image.evaluate(node=>getComputedStyle(node).objectFit),'contain');
    const surface=page.getByRole('region',{name:'Изображение: масштаб и перемещение'});await surface.focus();await page.keyboard.press('+');await expect(page.getByText('150%',{exact:true})).toBeVisible();await page.keyboard.press('0');await expect(page.getByText('100%',{exact:true})).toBeVisible();
    await page.keyboard.press('Escape');await expect(image).toHaveCount(0);await expect(imageName).toBeFocused();
    const production=groups.getByRole('region',{name:'Производство',exact:true}),pdfRow=production.locator('[data-file-list-row="pdf"]');
    const download=page.waitForEvent('download');await pdfRow.getByRole('link').click();const original=await download;assert.equal(original.suggestedFilename(),files[1].fileName);
    const stream=await original.createReadStream();assert.ok(stream);const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),pdf);
    await pdfRow.getByRole('button',{name:/^Распечатать/}).click();await expect.poll(()=>page.evaluate<number>('window.printMetrics.calls.length')).toBe(1);await expect(page.locator('[data-file-print]')).toHaveCount(0);
    const cadRow=groups.getByRole('region',{name:'Монтаж',exact:true}).locator('[data-file-list-row="cad"]'),popup=page.locator('[data-slot="popover-content"]');
    await cadRow.getByRole('button',{name:/^Удалить файл/}).click();await popup.getByRole('button',{name:'Отмена',exact:true}).click();assert.deepEqual(await page.evaluate('window.qa.deleteCalls'),[]);
    await cadRow.getByRole('button',{name:/^Удалить файл/}).click();await popup.getByRole('button',{name:'Удалить',exact:true}).click();await expect(popup).toHaveCount(0);assert.deepEqual(await page.evaluate('window.qa.deleteCalls'),['cad']);assert.equal(await page.evaluate('window.qa.refreshes'),1);
  });
  await writeFile(path.join(directory,'receipt.json'),JSON.stringify({status:'COMPONENT_RUNTIME_PASS',scope:'real ProductMeasurement/ProductDocuments/FilesTab/FileList/FileViewer with synthetic transport',staging:'NOT_RUN',checks},null,2));
  console.log(JSON.stringify({status:'COMPONENT_RUNTIME_PASS',checks:checks.length,directory}));
});

test("actual print button loads original image/PDF, rejects errors and cleans retained resources", async () => {
  await withFiles({ width: 1440, height: 900 }, async (page, requests, release) => {
    const metrics = () => page.evaluate<Metrics>("window.printMetrics"), settle = () => expect(page.locator("[data-file-print]")).toHaveCount(0);
    const render = async (file: Partial<FileListItem> & { disabled?: boolean }) => { await page.evaluate(`window.fixture.render(${JSON.stringify({ ...files[0], ...file })})`); await page.getByRole("button", { name: /^Распечатать/ }).waitFor(); };
    await render({ disabled: true }); assert.equal(await page.getByRole("button", { name: /^Распечатать/ }).isDisabled(), true);
    await render({ id: "slow", fileName: "slow.png" }); await page.getByRole("button", { name: "Распечатать slow.png" }).click();
    await expect(page.getByRole("button", { name: "Распечатать slow.png" })).toHaveAttribute("aria-busy", "true"); await page.getByRole("button", { name: "Распечатать slow.png" }).evaluate(node => (node as HTMLButtonElement).click());
    assert.match(await page.evaluate<string>(`window.fixture.printViewableFile({id:'slow',fileName:'slow.png',mimeType:'image/png'}).then(()=>'',error=>error.message)`), /уже готовится/i);
    release(); await expect.poll(async () => (await metrics()).calls.length).toBe(1); await settle(); assert.equal(requests.filter(url => url.endsWith("/slow")).length, 1);
    assert.equal((await metrics()).rowClicks, 0);
    for (const [id, width, height] of [["image", 1200, 300], ["tall", 300, 1200], ["square", 500, 500]] as const) {
      await page.evaluate(`window.fixture.printViewableFile(${JSON.stringify({ id, fileName: `${id}.png`, mimeType: "image/png" })})`); await settle();
      const call = (await metrics()).calls.at(-1)!; assert.deepEqual(call.image, { width, height, fit: "contain" }); assert.doesNotMatch(call.text, /CRM_CHROME/);
    }
    for (const source of ["project", "finance"]) {
      await page.evaluate(`window.fixture.printViewableFile(${JSON.stringify({ id: source === "finance" ? "finance" : "pdf", source, fileName: "Original.pdf", mimeType: "application/pdf" })})`); await settle();
      const call = (await metrics()).calls.at(-1)!; assert.equal(call.contentType, "application/pdf"); assert.doesNotMatch(call.text, /CRM_CHROME/);
    }
    for (const [id, mimeType] of [["denied", "image/png"], ["login", "image/png"], ["redirect", "image/png"], ["broken-pdf", "application/pdf"], ["bad-image", "image/png"]]) {
      const before = (await metrics()).calls.length;
      assert.equal(await page.evaluate(`window.fixture.printViewableFile(${JSON.stringify({ id, mimeType, fileName: id })},{prepareTimeoutMs:1000}).then(()=>false,()=>true)`), true);
      await settle(); assert.equal((await metrics()).calls.length, before);
    }
    await page.evaluate("window.fixture.printViewableFile({id:'svg',fileName:'image.svg',mimeType:'image/svg+xml'})"); await settle(); assert.equal(await page.evaluate("Boolean(window.svgExecuted)"), false);
    const beforeDisabledPdf = (await metrics()).calls.length;
    assert.equal(await page.evaluate(`(async()=>{const previous=navigator.pdfViewerEnabled;Object.defineProperty(navigator,'pdfViewerEnabled',{value:false,configurable:true});try{return await window.fixture.printViewableFile({id:'pdf',fileName:'pdf.pdf',mimeType:'application/pdf'}).then(()=>false,()=>true);}finally{Object.defineProperty(navigator,'pdfViewerEnabled',{value:previous,configurable:true});}})()`), true);
    assert.equal(await page.evaluate(`(async()=>{const create=document.createElement.bind(document);document.createElement=(tag,...args)=>{const element=create(tag,...args);if(tag==='iframe')Object.defineProperty(element,'contentDocument',{get:()=>document});return element;};try{return await window.fixture.printViewableFile({id:'pdf',fileName:'pdf.pdf',mimeType:'application/pdf'}).then(()=>false,()=>true);}finally{document.createElement=create;}})()`), true);
    assert.equal((await metrics()).calls.length, beforeDisabledPdf); await settle();
    await page.evaluate("window.autoAfterPrint=false"); await page.evaluate(`window.fixture.printViewableFile(${JSON.stringify(files[0])},{resourceTimeoutMs:50})`); await settle();
    await page.evaluate(`window.fixture.printViewableFile(${JSON.stringify(files[0])})`); await expect(page.locator("[data-file-print]")).toHaveCount(1);
    await page.evaluate("window.fixture.printViewableFile({id:'tall',fileName:'tall.png',mimeType:'image/png'})"); await expect(page.locator("[data-file-print]")).toHaveCount(1);
    await page.evaluate("dispatchEvent(new Event('pagehide'))"); await settle();
    await render({ source: "finance", id: "finance", fileName: "Report.pdf", mimeType: "application/pdf" });
    assert.equal(await page.getByRole("button", { name: "Удалить файл Report.pdf" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Распечатать Report.pdf" }).isDisabled(), false);
    const beforeUnmount = (await metrics()).calls.length; await page.getByRole("button", { name: "Распечатать Report.pdf" }).click();
    await expect.poll(async () => (await metrics()).calls.length).toBe(beforeUnmount + 1);
    await page.evaluate("window.fixture.unmount()"); await settle(); const result = await metrics(); assert.equal(result.created.length, result.revoked.length);
    assert.ok(requests.includes("/api/files/pdf?view=1")); assert.ok(requests.includes("/api/finance/documents/finance?view=1"));
  });
  for (const mode of ["abort", "timeout"]) await withFiles({ width: 1440, height: 900 }, async (page, _requests, release) => {
    const requested = page.waitForRequest(request => request.url().endsWith("/api/files/slow"));
    await page.evaluate(`window.abortPreparation=new AbortController();window.preparation=null;void window.fixture.printViewableFile({id:'slow',fileName:'slow.png',mimeType:'image/png'},{signal:window.abortPreparation.signal,prepareTimeoutMs:${mode === "timeout" ? 25 : 5000}}).then(()=>window.preparation={ok:true},error=>window.preparation={ok:false,name:error.name,message:error.message});`);
    await requested; if (mode === "abort") await page.evaluate("window.abortPreparation.abort()");
    await page.waitForFunction("window.preparation!==null"); assert.equal(await page.evaluate("window.preparation.ok"), false);
    if (mode === "abort") assert.equal(await page.evaluate("window.preparation.name"), "AbortError");
    else assert.match(await page.evaluate<string>("window.preparation.message"), /время ожидания/i);
    release(); await expect(page.locator("[data-file-print]")).toHaveCount(0); assert.equal(await page.evaluate("window.printMetrics.calls.length"), 0);
  });
});
