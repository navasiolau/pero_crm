import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire, Module } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { chromium } from "@playwright/test";
import { engineerFixture } from "./helpers/visibility-fixture";

if (!process.argv.includes("--local-fixtures")) throw Error("LOCAL_FIXTURES_GUARD_REQUIRED");

async function main() {
const artifacts = new URL("../test-results/safe-file-response/", import.meta.url);
await mkdir(artifacts, { recursive: true });
const require = createRequire(import.meta.url);
function inject(specifier: string, exports: Record<string, unknown>) {
  const filename = require.resolve(specifier), stub = new Module(filename);
  stub.filename = filename; stub.loaded = true; stub.exports = exports; require.cache[filename] = stub;
}
function pdfBytes() {
  const stream = "BT /F1 24 Tf 72 720 Td (SAFE FILE 129) Tj ET";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) text += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}
const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#4488aa" } }).png().toBuffer();
const pdf = pdfBytes(), html = Buffer.from("<!doctype html><title>inert file</title><p>safe fixture</p>");
const fixture = engineerFixture(), ownFile = fixture.files.find(file => file.id === "file-own")!;
const objects = new Map<string, Buffer>();
for (const [id, mimeType, name, bytes] of [
  ["file-image", "image/png", "Эскиз.png", png], ["file-pdf", "application/pdf", "Документ.pdf", pdf],
  ["file-html", "text/html", "inert.html", html],
] as const) {
  const storedName = `${id}.original`;
  fixture.files.push({ ...ownFile, id, fileName: name, mimeType, storedName, hasThumb: false, size: bytes.length, createdAt: new Date(0) });
  objects.set(`mixed/${storedName}`, bytes);
}
inject("../src/auth", { auth: async () => ({ user: { id: "engineer", roles: ["ENGINEER"] } }) });
inject("../src/lib/prisma", { prisma: fixture.db });
inject("../src/lib/s3", { UPLOADS_ROOT: "never-used", s3Enabled: () => true,
  fileKey: (project: string, name: string) => `${project}/${name}`,
  s3Get: async (key: string) => { const bytes = objects.get(key); return bytes ? new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) : null; },
});
const route = require("../src/app/api/files/[id]/route");
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const bundle = await build({ stdin: { contents: "import * as printer from './src/lib/browser-file-print'; window.probePrinter=printer;", resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "ts" }, bundle: true, platform: "browser", format: "iife", write: false, logLevel: "silent" });
const index = '<!doctype html><html lang="ru"><body><h1>Local actual file GET</h1><img id="thumb" src="/api/files/file-image?thumb=1"><img id="original" src="/api/files/file-image"><iframe id="pdf" style="width:640px;height:640px" src="/api/files/file-pdf?view=1"></iframe><a id="download" download href="/api/files/file-image">Скачать оригинал</a><script src="/print.js"></script></body></html>';
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url!, "http://localhost");
    if (url.pathname === "/favicon.ico") { response.statusCode = 204; response.end(); return; }
    if (url.pathname === "/") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(index); return; }
    if (url.pathname === "/print.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text); return; }
    const id = url.pathname.split("/").at(-1)!;
    const result: Response = await route.GET(new Request(url.href), { params: Promise.resolve({ id }) });
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) { response.statusCode = 500; response.end(String(error)); }
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const evidence: Record<string, unknown> = { target: "local in-memory actual handler", csp: "sandbox" };
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  evidence.browser = browser.version();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page.setDefaultTimeout(10_000);
  const consoleErrors: string[] = [], pageErrors: string[] = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.waitForFunction(() => [...document.images].every(image => image.naturalWidth > 0));
  evidence.imageDimensions = await page.locator("img").evaluateAll(elements => elements.map(image => ({ width: (image as HTMLImageElement).naturalWidth, height: (image as HTMLImageElement).naturalHeight })));
  const nativePdf = page.frames().find(frame => frame.url().endsWith("file-pdf?view=1"))!;
  assert.ok(nativePdf);
  evidence.pdfView = await nativePdf.evaluate(() => ({ contentType: document.contentType, embedCount: document.querySelectorAll('embed[type="application/pdf"]').length, text: document.body?.textContent }));
  assert.equal((evidence.pdfView as { contentType: string }).contentType, "application/pdf");
  await page.screenshot({ path: fileURLToPath(new URL("browser.png", artifacts)) });
  const downloadReady = page.waitForEvent("download");
  await page.locator("#download").click();
  const download = await downloadReady, stream = await download.createReadStream(), chunks: Buffer[] = [];
  assert.equal(download.suggestedFilename(), "Эскиз.png");
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  assert.equal(hash(Buffer.concat(chunks)), hash(png)); evidence.downloadSha256 = hash(png);
  const unsafe = await page.request.get(`${origin}/api/files/file-html?thumb=1&view=1`);
  assert.equal(unsafe.status(), 415); evidence.unsafeThumbStatus = unsafe.status();
  evidence.pdfPrint = await page.evaluate(async () => {
    const printer = (window as unknown as { probePrinter: { printViewableFile: (file: object, options: object) => Promise<void> } }).probePrinter;
    try { await printer.printViewableFile({ id: "file-pdf", fileName: "Документ.pdf", mimeType: "application/pdf" }, { prepareTimeoutMs: 5_000, resourceTimeoutMs: 1_000 }); return { status: "PASS", kind: "headless browser API, physical/native preview NOT_RUN" }; }
    catch (error) { return { status: "FAIL", error: String(error) }; }
  });
  assert.equal((evidence.pdfPrint as { status: string }).status, "PASS");
  evidence.consoleErrors = consoleErrors; evidence.pageErrors = pageErrors;
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await writeFile(fileURLToPath(new URL("browser.json", artifacts)), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally { await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
