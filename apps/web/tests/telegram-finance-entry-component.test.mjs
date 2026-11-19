import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
const { chromium } = require("@playwright/test");
const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Telegram financial entry forwards only signed raw init data and navigates within the same origin", async () => {
  const bundle = await build({
    stdin: { contents: `
      import { createRoot } from "react-dom/client";
      import { TelegramFinanceEntry } from "@/app/telegram/finance/telegram-finance-entry";
      createRoot(document.querySelector("#root")).render(<TelegramFinanceEntry />);
    `, resolveDir: web, loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    let payload;
    let posted = 0;
    await page.route("https://finance.test/**", async route => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname === "/api/telegram/finance/session") {
        posted++;
        payload = request.postData();
        await route.fulfill({ json: { ok: true } });
      } else if (pathname === "/telegram/finance") {
        await route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
      } else if (pathname === "/finance") {
        await route.fulfill({ contentType: "text/html", body: '<h1>Финансы</h1>' });
      } else await route.abort();
    });
    await page.goto("https://finance.test/telegram/finance");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByText("Подключаем финансы…").waitFor();
    assert.equal(posted, 0);
    await page.evaluate(() => {
      window.Telegram = { WebApp: { initData: "user=signed-payload", initDataUnsafe: { user: { id: 99 } }, ready() {}, expand() {} } };
    });
    await page.waitForURL("https://finance.test/finance");
    assert.equal(posted, 1);
    assert.equal(payload, "user=signed-payload");
  } finally {
    await browser.close();
  }
});
