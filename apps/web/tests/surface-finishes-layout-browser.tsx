// Component layout proof only: production CSS/fonts, no CRM server, network or database.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "@playwright/test";
import { CompositionFinishDisplay, type CompositionFinish } from "../src/components/composition-finish-display";
import { CompositionFinishForm, type CompositionFinishFormValues } from "../src/components/composition-finish-form";

(globalThis as { React?: typeof React }).React = React;

async function main() {
  const finishes: CompositionFinish[] = [
    { id: "f1", itemId: "p1", surfaceKind: "FACE", surfaceLabel: "Лицевая сторона фасада", normalizedSurfaceLabel: "ЛИЦЕВАЯ СТОРОНА ФАСАДА",
      layerOrder: 1, finishKind: "VENEER", name: "Шпон дуба с продольным направлением волокон", code: "OAK-№1-²", colorHex: null, sampleFileId: null },
    { id: "f2", itemId: "p1", surfaceKind: "FACE", surfaceLabel: "Лицевая сторона фасада", normalizedSurfaceLabel: "ЛИЦЕВАЯ СТОРОНА ФАСАДА",
      layerOrder: 2, finishKind: "COATING", name: "Защитный матовый лак", code: "ПРОЗРАЧНЫЙ-ЛАК-".repeat(10), colorHex: null, sampleFileId: null },
    { id: "f3", itemId: "p1", surfaceKind: "EDGE", surfaceLabel: "Верхняя кромка со стороны помещения", normalizedSurfaceLabel: "ВЕРХНЯЯ КРОМКА СО СТОРОНЫ ПОМЕЩЕНИЯ",
      layerOrder: 1, finishKind: "ENAMEL", name: "Зелёная эмаль", code: "GREEN-01", colorHex: "#206C4A", sampleFileId: null },
  ];
  const initial: CompositionFinishFormValues = { itemId: "p1", surfaceKind: "FACE", surfaceLabel: "Лицевая сторона фасада",
    layerOrder: "1", finishKind: "VENEER", name: "Шпон дуба с продольным направлением волокон", code: "OAK-№1-²", colorHex: "", sampleFileId: "" };
  const states = {
    display: renderToStaticMarkup(<CompositionFinishDisplay finishes={finishes} canEdit onAdd={() => {}} onEdit={() => {}} onDelete={() => {}} />),
    form: renderToStaticMarkup(<CompositionFinishForm initial={initial} existing={[]} sampleFiles={[]} onSubmit={() => {}} onCancel={() => {}}
      error="Состав изменился. Обновите карточку перед повторным сохранением покрытия." />),
  };
  const cssDir = join(process.cwd(), ".next", "static", "css");
  let css = (await Promise.all((await readdir(cssDir)).filter((name) => name.endsWith(".css"))
    .map((name) => readFile(join(cssDir, name), "utf8")))).join("\n");
  for (const url of new Set(css.match(/\/_next\/static\/media\/[a-zA-Z0-9._-]+\.woff2/g) ?? [])) {
    const bytes = await readFile(join(process.cwd(), ".next", "static", "media", url.split("/").at(-1)!));
    css = css.replaceAll(url, `data:font/woff2;base64,${bytes.toString("base64")}`);
  }
  const output = await mkdtemp(join(tmpdir(), "pero-finishes-layout-"));
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const [width, height] of [[360, 800], [390, 844], [1440, 900]]) {
      for (const [state, markup] of Object.entries(states)) {
        const page = await browser.newPage({ viewport: { width, height } });
        await page.route("**/*", (route) => route.abort());
        await page.setContent(`<!doctype html><html lang="ru" style="--font-roboto:Roboto"><head><meta charset="utf-8"><style>${css}</style></head><body><main style="padding:16px"><div style="max-width:${state === "form" ? "576px" : "100%"};padding:24px;border:1px solid #ddd;border-radius:12px">${markup}</div></main></body></html>`);
        await page.evaluate(() => document.fonts.ready);
        const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          controls: [...document.querySelectorAll("button,input,select")].map((element) => {
            const rect = element.getBoundingClientRect();
            return { x: rect.x, right: rect.right, height: rect.height };
          }) }));
        await page.screenshot({ path: join(output, `${width}-${state}-full.png`), fullPage: true });
        await page.screenshot({ path: join(output, `${width}-${state}-top.png`) });
        await page.locator("button").last().scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(output, `${width}-${state}-bottom.png`) });
        results.push({ state, ...metrics });
        await page.close();
      }
    }
    await writeFile(join(output, "metrics.json"), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ output, viewports: results.map(({ state, width, scrollWidth }) => ({ state, width, scrollWidth })) }));
    for (const result of results) {
      assert.ok(result.scrollWidth <= result.width, `${result.state} ${result.width}: horizontal overflow`);
      assert.ok(result.controls.every((rect) => rect.x >= 0 && rect.right <= result.width && rect.height >= 44), `${result.state} ${result.width}: controls out of bounds or too short`);
    }
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
