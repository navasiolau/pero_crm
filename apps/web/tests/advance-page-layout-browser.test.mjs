import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { launchCardBrowser } from "./product-card-navigation-browser.mjs";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(web, "package.json"));
const longName = "ОченьДлинноеНазвание".repeat(20);
const html = '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>';

const fixture = `
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AdvancesView } from "@/app/(app)/advances/view";
import { AdvancePayoutDialog } from "@/app/(app)/advances/advance-payout-dialog";

const users = [{ id: "worker", name: ${JSON.stringify(longName)}, position: "Сборщик" }];
const accounts = [
  { id: "usd", name: ${JSON.stringify(longName)}, currency: "USD", active: true, balance: 100 },
  { id: "byn", name: "Касса в BYN", currency: "BYN", active: true, balance: 700 },
  { id: "closed", name: "Неактивная касса", currency: "EUR", active: false, balance: 300 },
];

function Fixture() {
  const [open, setOpen] = useState(false);
  return <>
    <main style={{ width: 960, maxWidth: "100%" }}>
      <AdvancesView users={users} accounts={accounts} />
    </main>
    <button onClick={() => setOpen(true)}>Открыть диалог</button>
    <AdvancePayoutDialog open={open} onOpenChange={setOpen} users={users} accounts={accounts} />
  </>;
}

createRoot(document.getElementById("root")).render(<Fixture />);
`;

const boundaries = {
  "next/navigation": 'export const useRouter = () => ({ refresh() {} });',
  "@/server/payroll/actions": 'export const addPayout = () => { throw Error("Запись запрещена в тесте"); };',
  "@/server/payroll/cash-actions": `
    import { calculateCashPayout } from "@/lib/cash-ledger";
    export const issueAdvance = () => { throw Error("Запись запрещена в тесте"); };
    export async function previewCashPayout(input) {
      window.advancePreviewInput = input;
      const date = new Date().toISOString().slice(0, 10);
      return { ok: true, preview: calculateCashPayout(input.cashAmount, {
        asOf: date,
        cash: { currency: "USD", rate: "3.000000", date },
        payroll: { currency: "BYN", rate: "1.000000", date },
      }) };
    }
  `,
};

test("страница аванса адаптируется к ширине контента, сохраняя расчёт и форму диалога", { timeout: 60000 }, async () => {
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
  const built = await build({
    stdin: { contents: fixture, loader: "tsx", resolveDir: web },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "advance-fixture", setup(builder) {
      builder.onResolve({ filter: /^(next\/|@\/)/ }, ({ path }) =>
        Object.hasOwn(boundaries, path) ? { path, namespace: "advance-fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "advance-fixture" }, ({ path }) =>
        ({ contents: boundaries[path], loader: "tsx", resolveDir: web }));
    } }],
  });

  const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss");
  const cssPath = path.join(web, "src/app/globals.css");
  const css = (await postcss([require("@tailwindcss/postcss")({ base: web })])
    .process(await readFile(cssPath, "utf8"), { from: cssPath })).css;

  const browser = await launchCardBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const url = "http://advance-fixture.test";
    await page.route(url + "/**", async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/app.css") return route.fulfill({ contentType: "text/css", body: css });
      if (pathname === "/app.js") return route.fulfill({ contentType: "text/javascript", body: built.outputFiles[0].text });
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: html });
    });
    await page.goto(url);
    const main = page.getByRole("main");
    const form = main.locator("[data-slot=card]").first();
    const balances = main.getByRole("region", { name: "Остатки активных касс" });
    const employee = form.getByText("Сотрудник *", { exact: true });
    const cash = form.getByText("Касса *", { exact: true });
    await expect(balances.locator("[data-slot=card]")).toHaveCount(2);
    await expect(balances.getByText(/100\s*\$/)).toBeVisible();
    await expect(balances.getByText(/700.*BYN/)).toBeVisible();
    await expect(balances.getByText("Неактивная касса")).toHaveCount(0);
    const wideForm = await form.boundingBox();
    const wideBalances = await balances.boundingBox();
    assert.equal(wideForm.y, wideBalances.y);
    assert.ok(wideBalances.x >= wideForm.x + wideForm.width);
    assert.ok(Math.abs(wideForm.width / wideBalances.width - 2) < 0.02);
    assert.equal((await employee.boundingBox()).y, (await cash.boundingBox()).y);
    assert.ok((await cash.boundingBox()).x > (await employee.boundingBox()).x);

    await form.getByRole("button", { name: "Выберите сотрудника…" }).click();
    await page.getByRole("button", { name: longName + " Сборщик" }).click();
    await form.getByRole("button", { name: "Выберите кассу…" }).click();
    await page.getByRole("button", { name: /USD.*Доступно/ }).click();
    const remaining = await form.getByText(/Остаток:.*100\s*\$/).boundingBox();
    assert.equal(remaining.x, (await cash.boundingBox()).x);
    assert.ok(remaining.y > (await cash.boundingBox()).y);

    await form.getByLabel(/Сумма выдачи, USD/).fill("25.50");
    await form.getByLabel("Описание работы *").fill("Сборка шкафа");
    await form.getByRole("button", { name: "Рассчитать и проверить сумму" }).click();
    await expect(form.getByRole("heading", { name: "Предварительный расчёт" })).toBeVisible();
    assert.deepEqual(await page.evaluate(() => window.advancePreviewInput), {
      cashAccountId: "usd", cashAmount: "25.50", expectedCashCurrency: "USD",
    });
    await expect(form.getByText(/25,5\s*\$/)).toBeVisible();
    await expect(form.getByText(/76,5\s*BYN/)).toHaveCount(2);
    await expect(form.getByText(/3\.000000 BYN\/USD/)).toBeVisible();

    await main.evaluate(element => { element.style.width = "959px"; });
    assert.ok((await balances.boundingBox()).y >= (await form.boundingBox()).y + (await form.boundingBox()).height);
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok((await cash.boundingBox()).y > (await employee.boundingBox()).y);
    assert.ok((await balances.boundingBox()).y >= (await form.boundingBox()).y + (await form.boundingBox()).height);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Открыть диалог" }).click();
    const dialog = page.getByRole("dialog", { name: "Выдать аванс" });
    await dialog.evaluate(async element => {
      element.style.maxWidth = "760px";
      await Promise.all(element.getAnimations().map(animation => animation.finished));
    });
    const dialogEmployee = await dialog.getByText("Сотрудник *", { exact: true }).boundingBox();
    const dialogCash = await dialog.getByText("Касса *", { exact: true }).boundingBox();
    assert.equal(dialogEmployee.x, dialogCash.x);
    assert.ok(dialogCash.y > dialogEmployee.y);
  } finally {
    await browser.close();
  }
});
