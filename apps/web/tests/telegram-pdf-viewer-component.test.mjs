import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const { chromium } = require("@playwright/test");
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("scoped Mini App keeps financial PDFs and TTNs in the protected viewer", async () => {
  const files = await build({
    stdin: { contents: `
      import { createRoot } from "react-dom/client";
      import { FileListRow } from "@/components/file-list";
      import { LogisticsDocuments } from "@/components/logistics/documents";
      import { TelegramFileViewerScope } from "@/components/file-viewer";
      const finance = {id:"expense-1",fileName:"Расход.pdf",mimeType:"application/pdf",source:"finance",canDelete:false};
      const ttn = {id:"note-1",fileName:"ТТН.pdf",mimeType:"application/pdf",source:"logistics",stage:"SIGNED"};
      const content = <><FileListRow file={finance}/><LogisticsDocuments documents={[ttn]}/></>;
      createRoot(document.getElementById("root")).render(location.search
        ? <TelegramFileViewerScope>{content}</TelegramFileViewerScope> : content);
    `, resolveDir: web, loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "no-file-mutations", setup(builder) {
      builder.onResolve({ filter: /^@\/components\/file-(print-button|delete-popover)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const FilePrintButton=()=>null; export const FileDeletePopover=()=>null;" }));
    } }],
  });
  const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss");
  const cssPath = path.join(web, "src/app/globals.css");
  const css = (await postcss([require("@tailwindcss/postcss")({ base: web })]).process(await readFile(cssPath, "utf8"), { from: cssPath })).css;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.route("https://finance.test/**", route => route.fulfill({
      contentType: "text/html", body: `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style><div id="root"></div>`,
    }));
    await page.addInitScript(() => {
      window.__opened = [];
      window.open = (...args) => { window.__opened.push(args); return null; };
    });
    await page.goto("https://finance.test/finance?telegram=1");
    await page.addScriptTag({ content: files.outputFiles[0].text });
    for (const [name, route] of [["Расход.pdf", "/api/finance/documents/expense-1"], ["ТТН.pdf", "/api/logistics/documents/note-1"]]) {
      await page.getByRole("button", { name, exact: true }).click();
      const dialog = page.getByRole("dialog", { name });
      await dialog.waitFor();
      assert.equal(await dialog.getAttribute("data-file-viewer-variant"), "document-fullscreen");
      assert.equal(await dialog.locator("iframe").getAttribute("src"), route + "?view=1");
      assert.equal(await dialog.locator("a[download]").getAttribute("href"), route);
      await dialog.getByRole("button", { name: "Закрыть" }).click();
      await dialog.waitFor({ state: "hidden" });
    }
    assert.deepEqual(await page.evaluate(() => window.__opened), []);
    await page.goto("https://finance.test/finance");
    await page.addScriptTag({ content: files.outputFiles[0].text });
    const link = page.getByRole("link", { name: "Расход.pdf", exact: true });
    await link.waitFor();
    assert.equal(await link.getAttribute("download"), "Расход.pdf");
    await page.getByRole("button", { name: "ТТН.pdf", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__opened), [["/api/logistics/documents/note-1?view=1", "_blank", "noopener"]]);
  } finally {
    await browser.close();
  }
});
