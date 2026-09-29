// Отдельная проверка вёрстки компонента с CSS production build, без CRM/БД/сети.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "@playwright/test";
import { CompositionView, type CompositionData } from "../src/components/composition-view";

(globalThis as { React?: typeof React }).React = React;

async function main() {
  const revision = { id: "draft", status: "DRAFT" as const, revisionNo: null, draftVersion: 1,
    baseRevisionId: null, createdById: "qa", createdAt: "2026-09-29T00:00:00.000Z", confirmedById: null, confirmedAt: null };
  const data: CompositionData = { productId: "layout-only", productNumber: "QA", current: null, draft: revision,
    selected: revision, history: [], items: Array.from({ length: 16 }, (_, index) => ({
      id: `row-${index}`, revisionId: revision.id, lineageId: `lineage-${index}`, parentId: index ? `row-${index - 1}` : null,
      kind: index === 15 ? "PART" : "MODULE", designation: `М-${index + 1}-ОЧЕНЬДЛИННОЕОБОЗНАЧЕНИЕБЕЗПРОБЕЛОВ`,
      normalizedDesignation: `М-${index + 1}`, title: `Уровень ${index + 1} — модуль шкафа`,
      quantityPerParent: 1, effectiveQuantity: 1, depth: index + 1, travelsToInstallation: true, sortOrder: 0,
      createdAt: revision.createdAt, updatedAt: revision.createdAt,
    })) };
  const cssDir = join(process.cwd(), ".next", "static", "css");
  let css = (await Promise.all((await readdir(cssDir)).filter((name) => name.endsWith(".css"))
    .map((name) => readFile(join(cssDir, name), "utf8")))).join("\n");
  const fontUrls = [...new Set(css.match(/\/_next\/static\/media\/[a-zA-Z0-9._-]+\.woff2/g) ?? [])];
  for (const url of fontUrls) {
    const bytes = await readFile(join(process.cwd(), ".next", "static", "media", url.split("/").at(-1)!));
    css = css.replaceAll(url, `data:font/woff2;base64,${bytes.toString("base64")}`);
  }
  const markup = renderToStaticMarkup(<CompositionView data={data} canEdit authorNames={{ qa: "QA редактор" }} />);
  const output = await mkdtemp(join(tmpdir(), "pero-composition-layout-"));
  const browser = await chromium.launch({ headless: true });
  const evidence = [];
  try {
    for (const [width, height] of [[360, 800], [390, 844], [1440, 900]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.route("**/*", (route) => route.abort());
      await page.setContent(`<!doctype html><html lang="ru" style="--font-roboto:Roboto"><head><meta charset="utf-8"><style>${css}</style></head><body><main style="padding:16px">${markup}</main></body></html>`);
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.fonts.check("18px Roboto", "Я")), true);
      const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        buttons: [...document.querySelectorAll("button")].map((button) => ({ label: button.getAttribute("aria-label"),
          x: button.getBoundingClientRect().x, right: button.getBoundingClientRect().right })) }));
      await page.screenshot({ path: join(output, `${width}-deep.png`), fullPage: true });
      await page.screenshot({ path: join(output, `${width}-top.png`) });
      await page.locator("li").last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(output, `${width}-bottom.png`) });
      const firstGroup = page.locator("details").first();
      await firstGroup.locator("summary").first().focus();
      await page.keyboard.press("Enter");
      assert.equal(await firstGroup.evaluate((element) => (element as HTMLDetailsElement).open), false);
      await page.keyboard.press("Enter");
      assert.equal(await firstGroup.evaluate((element) => (element as HTMLDetailsElement).open), true);
      evidence.push(metrics);
      await page.close();
    }
    await writeFile(join(output, "metrics.json"), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({ output, viewports: evidence.map(({ width, scrollWidth }) => ({ width, scrollWidth })) }));
    for (const metrics of evidence) {
      assert.ok(metrics.scrollWidth <= metrics.width, `${metrics.width}px: page overflows to ${metrics.scrollWidth}px`);
      assert.ok(metrics.buttons.every((button) => button.x >= 0 && button.right <= metrics.width), "Edit/delete controls must fit at every depth");
    }
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
