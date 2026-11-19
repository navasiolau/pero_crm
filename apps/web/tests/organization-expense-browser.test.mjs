import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchCardBrowser } from "./product-card-navigation-browser.mjs";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(web, "package.json"));
const fixture = `
import React, { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { OrganizationExpenseResults } from "@/components/organization-expense-results";
import { ListParamsProvider } from "@/lib/list-params";
import { resolveListState } from "@/lib/list-state";
import { parseListFilterValue } from "@/lib/list-filter-values";

const rows = Array.from({ length: 101 }, (_, index) => ({
  id: "payment-real-id-" + String(index + 1), direction: "EXPENSE", paidAt: "2026-11-20T10:00:00.000Z",
  amount: 10, bynAmount: 10, rate: 1, rateDate: null, currency: "BYN", project: null, reportDocuments: [],
  cashAccountName: ["Касса А", "Касса Б", "Касса В"][index % 3], expenseArticleName: index % 2 ? "Материалы" : "Прочее", lastActionId: "fixture-head",
  comment: "fixture", cash: ["a", "b", "c"][index % 3], article: index % 2 ? "materials" : "other",
}));
const options = { purpose: [], cash: ["a", "b", "c"].map((value, index) => ({ value, label: rows[index].cashAccountName })),
  article: [{ value: "materials", label: "Материалы" }, { value: "other", label: "Прочее" }], currency: [{ value: "BYN", label: "BYN" }], documentPresence: [], material: [], stockUnit: [] };
const subscribe = listener => { window.addEventListener("expense-fixture-route", listener); return () => window.removeEventListener("expense-fixture-route", listener); };
const getLocation = () => location.search;
function App() {
  const locationQuery = useSyncExternalStore(subscribe, getLocation);
  const saved = localStorage.getItem("expense-fixture");
  const query = resolveListState("organizationExpenses", Object.fromEntries(new URLSearchParams(locationQuery)), saved);
  const params = new URLSearchParams(query);
  const pageSize = params.get("pageSize") === "all" ? "all" : Number(params.get("pageSize")) || 10;
  const cash = parseListFilterValue(params.get("cash")), article = parseListFilterValue(params.get("article"));
  const selection = rows.filter(row => (!cash || cash.includes(row.cash)) && (!article || article.includes(row.article)) && (!params.get("id") || row.id.includes(params.get("id"))));
  const page = Number(params.get("page")) || 1;
  const shown = pageSize === "all" ? selection : selection.slice((page - 1) * pageSize, page * pageSize);
  return <main className="mx-auto max-w-[1480px] p-4">
    <ListParamsProvider section="organizationExpenses" initialQuery={query} preference={saved}>
      <OrganizationExpenseResults rows={shown} options={options} page={page} pageSize={pageSize} total={selection.length}
        totalByn={(selection.length * 10).toFixed(2)} sort="date" dir="desc" cashAccounts={[]} canAssignProject
        projects={[{ id: "project-124", number: "124", title: "Действующий проект", currency: "BYN" },
          { id: "other-currency", number: "125", title: "Архивный курс", currency: "EUR" }]}/>
    </ListParamsProvider>
  </main>;
}
createRoot(document.getElementById("root")).render(<App/>);
`;
const boundaries = {
  "next/navigation": 'export const useRouter = () => ({ replace(href) { history.replaceState(null, "", href); dispatchEvent(new Event("expense-fixture-route")); }, refresh() {} });',
  "next/link": 'export default function Link({ children, ...props }) { return <a {...props}>{children}</a>; }',
  "@/components/payment-dialog": "export function PaymentDialog() { return null; }",
  "@/components/report-document-button": "export function ReportDocumentButton() { return null; }",
  "@/server/payments/project-assignment-actions": 'export async function assignOrdinaryExpenseProject(input) { window.__fixtureAssignment = input; return { ok:true, changed:true }; }',
  "@/server/payments/actions": 'export async function deletePayment() { throw Error("UNEXPECTED_DELETE"); }',
  "@/server/list-preferences-actions": 'export async function saveListPreference(section, query) { const value = JSON.stringify({version:2, engineerFilterInitialized:true, query}); localStorage.setItem("expense-fixture", value); return { ok:true, value }; }',
};

test("реестр расходов в Chromium сохраняет фильтры, показывает ID и всю выборку после 100", { timeout: 60000 }, async () => {
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
  const built = await build({
    stdin: { contents: fixture, loader: "tsx", resolveDir: web }, bundle: true, write: false,
    platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
    plugins: [{ name: "expense-fixture-boundaries", setup(builder) {
      builder.onResolve({ filter: /^(?:next\/|@\/)/ }, args => boundaries[args.path] ? { path: args.path, namespace: "expense-fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "expense-fixture" }, args => ({ contents: boundaries[args.path], loader: "tsx", resolveDir: web }));
    } }],
  });
  const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss");
  const cssPath = path.join(web, "src/app/globals.css");
  const css = (await postcss([require("@tailwindcss/postcss")({ base: web })]).process(await readFile(cssPath, "utf8"), { from: cssPath })).css;
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method !== "GET" || !["/finance/expenses", "/app.css", "/app.js"].includes(url.pathname)) {
      response.writeHead(404); response.end(); return;
    }
    response.setHeader("content-type", url.pathname === "/app.css" ? "text/css" : url.pathname === "/app.js" ? "text/javascript" : "text/html; charset=utf-8");
    response.end(url.pathname === "/app.css" ? css : url.pathname === "/app.js" ? built.outputFiles[0].contents :
      '<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await launchCardBrowser();
    const { expect } = await import("@playwright/test");
    const url = "http://127.0.0.1:" + server.address().port + "/finance/expenses";
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    const table = page.getByRole("table");
    await expect(table.getByRole("columnheader").first()).toHaveText("ID");
    await expect(table.getByRole("cell", { name: "payment-real-id-1", exact: true })).toBeVisible();
    await page.getByRole("combobox").click();
    await expect(page.getByRole("option").last()).toHaveText("Все");
    await page.getByRole("option", { name: "Все", exact: true }).click();
    await expect(table.getByRole("cell", { name: "payment-real-id-101", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Вперёд", exact: true })).toHaveCount(0);
    await expect(page.locator("[aria-live=polite]").filter({ hasText: "Итого по выборке" })).toHaveText(/1\s?010[,.]00 BYN/);
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "100", exact: true }).click();
    await expect(page.getByText("Стр. 1 из 2", { exact: true })).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.has("page"), false);

    await page.getByRole("form", { name: "Фильтры расходов" }).getByRole("button", { name: "Касса", exact: true }).click();
    await page.getByRole("checkbox", { name: "Касса А" }).check();
    await page.getByRole("checkbox", { name: "Касса Б" }).check();
    await page.keyboard.press("Escape");
    await page.getByRole("form", { name: "Фильтры расходов" }).getByRole("button", { name: "Статья", exact: true }).click();
    await page.getByRole("checkbox", { name: "Материалы" }).check();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Применить", exact: true }).click();
    await expect(page.getByText("34 записей", { exact: false })).toBeVisible();
    await page.goto(url);
    await expect(page.getByText("34 записей", { exact: false })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText("ID payment-real-id-2", { exact: true })).toBeVisible();
    await page.getByText("ID payment-real-id-2", { exact: true }).click();
    await expect(page.getByRole("dialog").getByText("payment-real-id-2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Назначить на проект", exact: true }).click();
    const assignment = page.getByRole("dialog", { name: "Назначить расход на проект" });
    await expect(assignment.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
    await assignment.getByLabel("Проект", { exact: true }).click();
    await page.getByPlaceholder("Поиск по номеру и названию").fill("124");
    await page.getByRole("button", { name: "124 · Действующий проект", exact: true }).click();
    await assignment.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(assignment).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => window.__fixtureAssignment), {
      paymentId: "payment-real-id-2", expectedProjectId: null, expectedHead: "fixture-head", projectId: "project-124",
    });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
