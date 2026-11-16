import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchCardBrowser } from "./product-card-navigation-browser.mjs";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(web, "package.json"));
const entry = `
import React from 'react';import{createRoot}from'react-dom/client';
import{ProjectTabs,ProjectTabsList}from'@/components/project-tabs';
import{TabsContent,TabsTrigger}from'@/components/ui/tabs';
const labels=['Общее','Изделия (25)','Файлы (120)','Задачи (14)','Материалы','Финансы','Логистика'];
if(location.search.includes('plugin'))labels.push('Модуль с очень длинным названием '+ 'производство'.repeat(12));
labels.push('Журнал');
createRoot(document.getElementById('root')).render(<main className="min-w-0 p-4 md:ml-64 md:p-6"><ProjectTabs initialTab="0"><ProjectTabsList>{labels.map((label,index)=><TabsTrigger key={index} className="shrink-0" value={String(index)}>{label}</TabsTrigger>)}</ProjectTabsList>{labels.map((label,index)=><TabsContent key={index} value={String(index)}>Содержимое: {label}</TabsContent>)}</ProjectTabs></main>);
`;

test("project tabs stay visible without scrolling and preserve keyboard navigation", { timeout: 90000 }, async () => {
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
  const bundle = await build({ stdin: { contents: entry, loader: "tsx", resolveDir: web }, bundle: true, write: false,
    platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss");
  const css = (await postcss([require("@tailwindcss/postcss")({ base: web })]).process(
    await readFile(path.join(web, "src/app/globals.css"), "utf8"), { from: path.join(web, "src/app/globals.css") })).css + "\n:root{--font-roboto:Arial}";
  const directory = path.join(web, "test-results/project-tabs-229");
  await mkdir(directory, { recursive: true });
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (request.method !== "GET" || !["/", "/app.css", "/app.js"].includes(url.pathname)) { response.writeHead(404); response.end(); return; }
    response.setHeader("content-type", url.pathname === "/app.css" ? "text/css" : url.pathname === "/app.js" ? "text/javascript" : "text/html; charset=utf-8");
    response.end(url.pathname === "/app.css" ? css : url.pathname === "/app.js" ? bundle.outputFiles[0].contents : '<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    browser = await launchCardBrowser();
    const { expect } = await import("@playwright/test");
    for (const width of [360, 390, 1024, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      for (const plugin of [false, true]) {
        await page.goto(`http://127.0.0.1:${server.address().port}/${plugin ? "?plugin" : ""}`);
        const list = page.getByRole("tablist"), tabs = page.getByRole("tab");
        await expect(tabs.last()).toHaveText("Журнал");
        const geometry = await list.evaluate(node => {
          const box = node.getBoundingClientRect();
          return { width: node.clientWidth, scrollWidth: node.scrollWidth, overflow: getComputedStyle(node).overflowX,
            buttons: [...node.querySelectorAll('[role="tab"]')].map(button => { const rect = button.getBoundingClientRect(); return { left: rect.left - box.left, right: rect.right - box.left, top: rect.top - box.top, bottom: rect.bottom - box.top }; }),
            height: box.height };
        });
        assert.ok(geometry.scrollWidth <= geometry.width + 1, `Panel must not overflow at ${width}px, plugin=${plugin}`);
        assert.ok(!["auto", "scroll"].includes(geometry.overflow), "Panel must not create a horizontal scrollbar");
        assert.ok(geometry.buttons.every(button => button.left >= -1 && button.right <= geometry.width + 1 && button.top >= -1 && button.bottom <= geometry.height + 1), "Every tab stays inside the panel");
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Page must not scroll horizontally");
        if (width === 1440 && !plugin) assert.equal(new Set(geometry.buttons.map(button => Math.round(button.top))).size, 1, "Ordinary desktop tabs form one row");
        await tabs.first().focus();
        await page.keyboard.press("End");
        await expect(tabs.last()).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
        await expect(page.locator('[role="tabpanel"]:not([inert])')).toHaveText("Содержимое: Журнал");
        await tabs.first().click();
        await expect(page.locator('[role="tabpanel"]:not([inert])')).toHaveText("Содержимое: Общее");
        await page.screenshot({ path: path.join(directory, `tabs-${width}${plugin ? "-plugin" : ""}.png`), fullPage: true });
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
