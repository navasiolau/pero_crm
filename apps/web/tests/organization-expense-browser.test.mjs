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
import { Toaster } from "sonner";
import { OrganizationExpenseResults } from "@/components/organization-expense-results";
import { ListParamsProvider } from "@/lib/list-params";
import { resolveListState } from "@/lib/list-state";
import { parseListFilterValue } from "@/lib/list-filter-values";

const rows = Array.from({ length: 101 }, (_, index) => ({
  id: "payment-real-id-" + String(index + 1), direction: "EXPENSE", paidAt: "2026-11-20T10:00:00.000Z",
  amount: 10, bynAmount: 10, rate: 1, rateDate: null, currency: "BYN", project: index === 1 ? { id: "source", number: "402", title: "Проект чека", archived: false } : null,
  canPostExpenseReceipt: index <= 1, reportDocuments: index ? [] : [
    { id: "first", fileName: "Длинное-имя-отчётного-документа-по-материалам.pdf", mimeType: "application/pdf", source: "finance" },
    { id: "second", fileName: "Второй чек.jpg", mimeType: "image/jpeg", source: "finance" },
  ], lastActionId: "fixture-head", hasActiveExpenseReceipt: index === 3,
  receiptLines: index === 3 ? [{ movementId:"source-line", materialId:"oak", materialName:"Дуб", quantity:"10", unit:"шт.", amount:"10.00", unitPrice:"1", stockValueByn:"10.00" }] : [],
  cashAccountName: ["Касса А", "Касса Б", "Касса В"][index % 3], expenseArticleName: index % 2 ? "Материалы" : "Прочее",
  comment: index ? "fixture" : "Длинный комментарий о закупке и расчётах с поставщиком. ".repeat(12) + "Конец комментария.",
  cash: ["a", "b", "c"][index % 3], article: index % 2 ? "materials" : "other",
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
        totalByn={(selection.length * 10).toFixed(2)} sort={params.get("sort") || "date"} dir={params.get("dir") || "desc"} cashAccounts={[]} canAssignProject
        projects={[{ id: "source", number: "402", title: "Проект чека", currency: "BYN" },
          { id: "project-124", number: "124", title: "Действующий проект", currency: "BYN" },
          { id: "other-currency", number: "125", title: "Архивный курс", currency: "EUR" }]}
        stockMaterials={[{ id: "oak", name: "Дуб", unit: "шт." }, { id: "mdf", name: "МДФ", unit: "м²" }]}/>
    </ListParamsProvider>
    <Toaster/>
  </main>;
}
createRoot(document.getElementById("root")).render(<App/>);
`;
const boundaries = {
  "next/navigation": 'export const useRouter = () => ({ replace(href) { history.replaceState(null, "", href); dispatchEvent(new Event("expense-fixture-route")); }, refresh() {} });',
  "@/server/logistics/reallocation-actions": 'export const readTripReallocation=async()=>({ok:false}); export const readTripReallocationProducts=readTripReallocation; export const previewTripReallocation=readTripReallocation; export const saveTripReallocation=readTripReallocation;',
  "next/link": 'export default function Link({ children, ...props }) { return <a {...props}>{children}</a>; }',
  "@/components/payment-dialog": "export function PaymentDialog() { return null; }",
  "@/server/payments/project-assignment-actions": 'export async function assignOrdinaryExpenseProject(input) { window.__fixtureAssignment = input; return { ok:true, changed:true }; }',
  "@/server/warehouse/expense-issue-actions": `
    const source={movementId:"source-line",materialId:"oak",materialName:"Дуб",unit:"шт.",receiptQuantity:"10.000",issuedQuantity:"2.000",remainingQuantity:"8.000"};
    export async function getExpenseIssueChoices(input) {
      return {ok:true,sources:[source],choices: input.projectId ? [{id:"product",label:"124.1 · Шкаф"}] : [{id:"project-124",label:"124 · Действующий проект"}]};
    }
    export async function previewExpenseIssue(input) {
      window.expenseIssuePreview=input;
      return {ok:true,fingerprint:"confirmed-issue",totalByn:"12.50",lines:[{...source,quantity:"2.500",moneyByn:"12.50",warehouseBefore:"7.000",warehouseAfter:"4.500"}]};
    }
    export async function applyExpenseIssue(input) {window.expenseIssueApplied=input;return {ok:true,issueId:"issue"};}
  `,
  "@/server/warehouse/expense-receipt-actions": 'export async function previewExpenseReceipt(input) { window.previewInput = input; return { ok:true, fingerprint:"confirmed", actorId:"cashier", projectNumber:"402", lines:input.lines.map((row,index) => ({...row, materialName:index ? "МДФ" : "Дуб", unit:index ? "м²" : "шт.", bynAmount:row.amount})) }; } export async function applyExpenseReceipt(input,actor) { window.appliedReceipt = {input,actor}; return {ok:true,receiptId:"receipt"}; }',
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
    const header = table.getByRole("columnheader");
    await expect(header).toHaveCount(7);
    const backLink = page.getByRole("link", { name: "Назад к финансам", exact: true });
    const title = page.getByRole("heading", { level: 1, name: "Расходы организации" });
    await page.keyboard.press("Tab");
    await expect(backLink).toBeFocused();
    await expect(backLink).toHaveCSS("outline-style", "solid");
    await expect(backLink).toHaveAttribute("href", "/finance");
    const ledgerUrl = page.url();
    await title.click();
    await expect(page).toHaveURL(ledgerUrl);
    for (const [index, title] of ["ID", "Дата", "Назначение", "Касса", "Статья", "Сумма", "Документы"].entries())
      await expect(header.nth(index)).toContainText(title);
    const bodyRows = table.locator("tbody tr");
    const first = bodyRows.first();

    const detail = page.getByRole("dialog", { name: "Расход", exact: true });
    const detailFooter = detail.locator("[data-slot=dialog-footer]");
    const detailButton = name => detailFooter.getByRole("button", { name, exact: true });
    const openGeneralExpense = async () => {
      await first.click();
      await expect(detail.getByText("payment-real-id-1", { exact: true })).toBeVisible();
      await expect(detail.getByText(/Конец комментария\.$/)).toBeVisible();
    };
    const measureDetail = () => detail.evaluate(async dialog => {
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      await Promise.all(dialog.getAnimations().map(animation => animation.finished.catch(() => {})));
      const { left, top, right, bottom, width } = dialog.getBoundingClientRect();
      const full = left >= -2 && left <= 2 && top >= -2 && top <= 2 &&
        Math.abs(right - window.innerWidth) <= 2 && Math.abs(bottom - window.innerHeight) <= 2;
      const details = dialog.querySelector("dl");
      const noHorizontalScroll = dialog.scrollWidth <= dialog.clientWidth + 1 &&
        details.scrollWidth <= details.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1;
      return { width, full, noHorizontalScroll };
    });
    const expand = detail.getByRole("button", { name: "Развернуть на весь экран", exact: true });
    const restore = detail.getByRole("button", { name: "Вернуть размер", exact: true });
    await openGeneralExpense();
    const initialWidth = (await measureDetail()).width;
    assert.ok(initialWidth >= 1088 && initialWidth <= 1152, `Ширина открытого расхода при 1440 px: ${initialWidth}px`);
    await expand.click();
    assert.ok((await measureDetail()).full, "Кнопка разворачивает расход на весь доступный экран");
    await restore.click();
    assert.ok(Math.abs((await measureDetail()).width - initialWidth) <= 1, "Возвращается исходная ширина расхода");
    await expand.click();
    await detailButton("Закрыть").click();
    await expect(detail).toHaveCount(0);
    await openGeneralExpense();
    await expect(expand).toBeVisible();
    assert.ok(Math.abs((await measureDetail()).width - initialWidth) <= 1, "Повторное открытие возвращает широкий режим");

    const clipped = [];
    for (const [width, height] of [[320, 420], [320, 740], [390, 844], [640, 800], [768, 900], [1024, 768], [1366, 768], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      const box = await measureDetail();
      if (width <= 390) assert.ok(box.full && box.noHorizontalScroll, `Полнокадровый расход при ${width}×${height}`);
      if (width >= 1024) assert.ok(box.width >= (width >= 1366 ? 1088 : 960) && box.width <= 1152,
        `Ширина открытого расхода при ${width} px: ${box.width}px`);
      const rowPositions = [];
      for (const name of ["Назначить на проект", "Оприходовать на склад", "Закрыть", "Удалить"]) {
        const button = detailButton(name);
        await expect(button).toBeEnabled();
        const action = await button.evaluate(element => {
          const dialog = element.closest("[data-slot=dialog-content]");
          const frame = dialog.getBoundingClientRect(), button = element.getBoundingClientRect();
          const text = document.createRange();
          text.selectNodeContents(element);
          const left = Math.max(0, frame.left + dialog.clientLeft);
          const top = Math.max(0, frame.top + dialog.clientTop);
          const right = Math.min(window.innerWidth, frame.left + dialog.clientLeft + dialog.clientWidth);
          const bottom = Math.min(window.innerHeight, frame.top + dialog.clientTop + dialog.clientHeight);
          const inside = (rect, outer) => rect.left >= outer.left - 1 && rect.right <= outer.right + 1 &&
            rect.top >= outer.top - 1 && rect.bottom <= outer.bottom + 1;
          const label = [...text.getClientRects()].filter(rect => rect.width > 0);
          const x = button.left + button.width / 2, y = button.top + button.height / 2;
          const hitsButton = [[x, y], [button.left + 2, y], [button.right - 2, y], [x, button.top + 2], [x, button.bottom - 2]]
            .every(([px, py]) => element.contains(document.elementFromPoint(px, py)));
          const visible = inside(button, { left, top, right, bottom }) && label.length > 0 &&
            label.every(rect => inside(rect, button)) && hitsButton;
          return { visible, row: y, height: button.height, extraWidth: button.width - text.getBoundingClientRect().width };
        });
        if (!action.visible) clipped.push(`${width}×${height} · ${name}`);
        if (width >= 1024) assert.ok(action.height >= 28 && action.height <= 34 && action.extraWidth >= 8 && action.extraWidth <= 42,
          `Компактная кнопка «${name}» при ${width} px · ${action.height}px, отступы ${action.extraWidth}px`);
        rowPositions.push(action.row);
      }
      const rowSpread = Math.max(...rowPositions) - Math.min(...rowPositions);
      if (width >= 1024) assert.ok(rowSpread <= 2, `Действия в одной строке при ${width} px`);
      if (width === 320) assert.ok(rowSpread > 2, "На узком телефоне кнопки переносятся");
    }
    assert.deepEqual(clipped, [], "Кнопки расхода и их подписи должны быть видны целиком");
    const touch = await page.context().newCDPSession(page);
    await touch.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await page.setViewportSize({ width: 844, height: 390 });
    assert.ok((await measureDetail()).full, "После поворота телефона карточка занимает весь экран");
    await expect(expand).toBeHidden();
    await touch.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await touch.detach();
    await page.setViewportSize({ width: 320, height: 420 });
    await measureDetail();
    const commentEndReached = await detail.getByText(/Конец комментария\.$/).evaluate(comment => {
      const details = comment.closest("dl");
      const footer = details.parentElement.querySelector("[data-slot=dialog-footer]");
      const footerTop = footer.getBoundingClientRect().top;
      const frame = details.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(comment);
      details.scrollTop += [...range.getClientRects()].at(-1).bottom - frame.bottom;
      const lastLine = [...range.getClientRects()].at(-1);
      return details.scrollTop > 0 && lastLine.top >= frame.top - 1 && lastLine.bottom <= frame.bottom + 1 &&
        footer.getBoundingClientRect().top === footerTop;
    });
    assert.ok(commentEndReached, "На телефоне конец комментария доступен при прокрутке, а действия остаются на месте");

    await page.setViewportSize({ width: 640, height: 844 });
    await detailButton("Назначить на проект").click();
    const newAssignment = page.getByRole("dialog", { name: "Назначить расход на проект", exact: true });
    await newAssignment.getByRole("button", { name: "Отмена", exact: true }).click();
    await detailButton("Оприходовать на склад").click();
    const newReceipt = page.getByRole("dialog", { name: "Оприходовать на склад", exact: true });
    await expect(newReceipt.getByRole("button", { name: "Предпросмотр", exact: true })).toBeDisabled();
    await newReceipt.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Закрыть", exact: true }).click();
    await detailButton("Удалить").click();
    const deleteConfirmation = page.getByRole("dialog", { name: "Подтверждение удаления", exact: true });
    await deleteConfirmation.getByRole("button", { name: "Отмена", exact: true }).click();
    assert.ok(await page.evaluate(() => !window.__fixtureAssignment && !window.appliedReceipt));
    await page.setViewportSize({ width: 1440, height: 900 });
    await openGeneralExpense();
    await detailButton("Закрыть").click();
    await expect(detail).toHaveCount(0);

    const copy = first.getByRole("cell").first().getByRole("button", { name: "Скопировать ID" });
    await expect(copy).toBeVisible();
    await expect(first.getByRole("cell").first()).toHaveText("");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(url).origin });
    await copy.hover();
    await expect(page.getByRole("tooltip")).toHaveText("payment-real-id-1");
    await copy.click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "payment-real-id-1");
    await expect(page.getByText("ID скопирован", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await first.getByRole("button", { name: "Документы, 2" }).click();
    const files = page.getByRole("dialog", { name: "Документы", exact: true });
    await expect(files.getByText("Второй чек.jpg", { exact: true })).toBeVisible();
    await expect(files.getByRole("link", { name: "Длинное-имя-отчётного-документа-по-материалам.pdf" })).toHaveAttribute("href", "/api/finance/documents/first");
    await page.keyboard.press("Escape");
    await expect(files).toHaveCount(0);
    const amountHeading = header.nth(5).getByRole("button", { name: "Сумма" });
    for (const dir of ["asc", "desc"]) {
      await amountHeading.click();
      await page.getByRole("menuitem", { name: "Эквивалент BYN", exact: true }).click();
      await expect.poll(() => {
        const params = new URL(page.url()).searchParams;
        return [params.get("sort"), params.get("dir")];
      }).toEqual(["byn", dir]);
    }
    await page.getByRole("combobox").click();
    await expect(page.getByRole("option").last()).toHaveText("Все");
    await page.getByRole("option", { name: "Все", exact: true }).click();
    await expect(bodyRows).toHaveCount(101);
    await bodyRows.last().getByRole("button", { name: "Скопировать ID" }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "payment-real-id-101");
    await expect(page.getByRole("button", { name: "Вперёд", exact: true })).toHaveCount(0);
    await expect(page.locator("[aria-live=polite]").filter({ hasText: "Итого по выборке" })).toHaveText(/1\s?010[,.]00 BYN/);
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "100", exact: true }).click();
    await expect(page.getByText("Стр. 1 из 2", { exact: true })).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.has("page"), false);

    const toolbar = page.getByRole("group", { name: "Фильтры расходов", exact: true });
    const filterPage = await browser.newPage();
    try {
      const counters = new URLSearchParams({
        cash: "a", article: "materials",
        dateFrom: "2026-11-01", dateTo: "2026-11-30", amountFrom: "2", amountTo: "20",
      });
      const measurements = [];
      const activeToolbar = filterPage.getByRole("group", { name: "Фильтры расходов", exact: true });
      for (const width of [1920, 390, 360, 320]) {
        const purposeCount = width === 320 ? 12 : 2;
        counters.set("purpose", JSON.stringify(Array.from({ length: purposeCount }, (_, index) => `project-${index + 1}`)));
        await filterPage.setViewportSize({ width, height: 844 });
        await filterPage.goto(`${url}?${counters}`);
        const counts = [["Назначение", String(purposeCount)], ["Касса", "1"]];
        if (width < 400) counts.push(["Дата", "2"], ["Статья", "1"], ["Сумма", "2"]);
        for (const [caption, count] of counts) {
          const button = activeToolbar.getByRole("button", { name: caption, exact: true });
          const label = caption === "Назначение" && width < 360 ? "Назн." : caption;
          const text = await button.evaluate((button, fragments) => {
            const nodes = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
            const visible = [];
            while (nodes.nextNode()) {
              if (nodes.currentNode.parentElement.getClientRects().length) visible.push(nodes.currentNode);
            }
            const canvas = document.createElement("canvas").getContext("2d");
            const bounds = button.getBoundingClientRect();
            const arrow = button.querySelector("svg")?.getBoundingClientRect();
            return fragments.map(fragment => {
              const node = visible.find(node => node.data.includes(fragment));
              if (!node) return null;
              const range = document.createRange();
              const start = node.data.indexOf(fragment);
              range.setStart(node, start);
              range.setEnd(node, start + fragment.length);
              const { fontFamily, fontSize, fontStyle, fontWeight } = getComputedStyle(node.parentElement);
              canvas.font = `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`;
              // Range возвращает границы шрифтового прямоугольника, включая спуск под базовой линией.
              const { fontBoundingBoxDescent } = canvas.measureText(fragment);
              const rect = range.getBoundingClientRect();
              const fits = rect.width > 0 && rect.left >= bounds.left - 0.5 && rect.right <= (arrow?.width ? arrow.left : bounds.right) + 0.5
                && rect.top >= bounds.top - 0.5 && rect.bottom <= bounds.bottom + 0.5;
              return { fontSize, baseline: rect.bottom - fontBoundingBoxDescent, fits };
            });
          }, [label, "·", count]);
          measurements.push({ width, label, text });
        }
        if (width < 400) {
          const search = activeToolbar.getByRole("textbox", { name: "Поиск по расходам" });
          const area = await search.evaluate(input => {
            const bounds = input.getBoundingClientRect();
            const exact = input.parentElement.querySelector("button").getBoundingClientRect();
            const css = getComputedStyle(input);
            const left = bounds.left + parseFloat(css.paddingLeft) + parseFloat(css.borderLeftWidth);
            const right = Math.min(exact.left, bounds.right - parseFloat(css.paddingRight) - parseFloat(css.borderRightWidth));
            const x = right - 1, y = bounds.top + bounds.height / 2;
            return { x, y, usable: right - left, hitsInput: document.elementFromPoint(x, y) === input };
          });
          assert.ok(area.usable >= 24 && area.hitsInput, `Поиск должен оставаться редактируемым при ${width} px: ${JSON.stringify(area)}`);
          await filterPage.mouse.click(area.x, area.y);
          await expect(search).toBeFocused();
          await filterPage.keyboard.insertText("А");
          await expect(search).toHaveValue("А");
        }
      }
      assert.deepEqual(measurements.filter(({ text: [label, separator, count] }) =>
        !label?.fits || !separator?.fits || !count?.fits || label.fontSize !== count.fontSize
        || Math.abs(label.baseline - count.baseline) > 0.5), [],
      "Подпись, разделитель и счётчик должны помещаться в кнопку, подпись и счётчик должны иметь общий кегль и базовую линию");
    } finally {
      await filterPage.close();
    }
    const primary = ["Дата", "Назначение", "Касса", "Статья", "Сумма"];
    // В оболочке CRM боковое меню занимает 16 rem при ширине от 768 px.
    const sidebar = await page.addStyleTag({ content: "@media (min-width: 768px) { main { margin-left: 16rem; } }" });
    for (const width of [1920, 1366, 1024, 840, 768, 390, 360, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const [linkBox, iconBox, titleBox] = await Promise.all([
        backLink.boundingBox(), backLink.locator("svg").boundingBox(), title.boundingBox(),
      ]);
      assert.deepEqual([linkBox.width, linkBox.height, iconBox.width, iconBox.height], [40, 40, 16, 16]);
      assert.ok(linkBox.x + linkBox.width <= titleBox.x &&
        Math.abs(linkBox.y + linkBox.height / 2 - titleBox.y - titleBox.height / 2) <= 1,
        `Стрелка слева от заголовка и занимает только свой квадрат при ширине ${width}`);
      const controls = [toolbar.getByRole("textbox", { name: "Поиск по расходам" }),
        ...primary.map(name => toolbar.getByRole("button", { name, exact: true }))];
      const boxes = await Promise.all(controls.map(control => control.boundingBox()));
      assert.ok(boxes.every(box => box && box.width > 24 && box.x >= 0 && box.x + box.width <= width + 1));
      boxes.slice(1).forEach((box, index) => {
        assert.ok(box.x >= boxes[index].x + boxes[index].width - 1);
        assert.ok(Math.abs(box.y + box.height / 2 - boxes[0].y - boxes[0].height / 2) < 2);
      });
      for (const label of primary) {
        const caption = label === "Назначение" && width < 360 ? "Назн." : label;
        const control = toolbar.getByRole("button", { name: label, exact: true });
        const fits = await control.getByText(caption, { exact: true }).last().evaluate(text => {
          const button = text.closest("button");
          const range = document.createRange();
          range.selectNodeContents(text);
          const rect = range.getBoundingClientRect(), outer = button.getBoundingClientRect();
          const arrow = button.querySelector("svg")?.getBoundingClientRect();
          return rect.width > 0 && rect.left >= outer.left && rect.right <= (arrow?.width ? arrow.left : outer.right) + 1;
        });
        assert.ok(fits, `Подпись «${caption}» должна помещаться в кнопку при ширине ${width}`);
      }
    }
    await sidebar.evaluate(node => node.remove());
    await page.setViewportSize({ width: 1440, height: 900 });
    await toolbar.getByRole("button", { name: "Дата", exact: true }).click();
    const dates = page.getByRole("dialog", { name: "Дата", exact: true });
    for (const name of ["От", "До"]) {
      const calendar = dates.getByRole("group", { name, exact: true });
      await expect(calendar).toBeVisible();
      await calendar.locator("[data-date]").first().click();
    }
    await dates.getByRole("button", { name: "Применить" }).click();
    await expect.poll(() => new URL(page.url()).searchParams.has("dateTo")).toBe(true);
    await toolbar.getByRole("button", { name: "Касса", exact: true }).click();
    await page.getByRole("checkbox", { name: "Касса А" }).check();
    await page.getByRole("checkbox", { name: "Касса Б" }).check();
    await page.keyboard.press("Escape");
    await toolbar.getByRole("button", { name: "Статья", exact: true }).click();
    await page.getByRole("checkbox", { name: "Материалы" }).check();
    await page.keyboard.press("Escape");
    await expect(page.getByText("34 расхода", { exact: true })).toBeVisible();
    await page.goto(url);
    await expect(page.getByText("34 расхода", { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    const projectCard = page.getByRole("article", { name: "Открыть расход · 402 · Проект чека" });
    await projectCard.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog").getByText("payment-real-id-2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Изменить проект", exact: true }).click();
    const assignment = page.getByRole("dialog", { name: "Изменить проект расхода" });
    await expect(assignment.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
    await assignment.getByLabel("Проект", { exact: true }).click();
    await page.getByPlaceholder("Поиск по номеру и названию").fill("124");
    await page.getByRole("button", { name: "124 · Действующий проект", exact: true }).click();
    await assignment.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(assignment).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => window.__fixtureAssignment), {
      paymentId: "payment-real-id-2", expectedProjectId: "source", expectedHead: "fixture-head", projectId: "project-124",
    });
    await projectCard.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Оприходовать на склад" }).click();
    const dialog = page.getByRole("dialog", { name: "Оприходовать на склад" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Добавить материал" }).click();
    const entries = dialog.locator("fieldset");
    for (const [index, material] of ["Дуб", "МДФ"].entries()) {
      const entry = entries.nth(index);
      await entry.locator('button[id^="expense-material-"]').click();
      await page.locator('[data-slot="popover-content"][data-open]').getByText(material, { exact: true }).click();
      await entry.getByLabel("Количество").fill("2");
      await entry.getByLabel("Сумма, BYN").fill(index ? "6" : "4");
    }
    await dialog.getByRole("button", { name: "Предпросмотр" }).click();
    await expect(dialog.getByText(/будет снят с проекта 402/)).toBeVisible();
    assert.equal(await page.evaluate(() => window.appliedReceipt), undefined);
    await dialog.getByRole("button", { name: "Подтвердить оприходование" }).click();
    await expect(dialog).toHaveCount(0);
    const posted = await page.evaluate(() => window.appliedReceipt);
    assert.equal(posted.actor, "cashier");
    assert.deepEqual(posted.input.lines, [
      { materialId: "oak", quantity: "2", amount: "4" },
      { materialId: "mdf", quantity: "2", amount: "6" },
    ]);
    await page.getByRole("article", { name: "Открыть расход · Приход на склад" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog").getByText("payment-real-id-4", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Назначить на проект", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Выдать на изделие", exact: true }).click();
    const issue = page.getByRole("dialog", { name: "Выдать материалы по чеку" });
    await expect(issue.getByText(/выдано 2 · доступно по чеку 8/)).toBeVisible();
    await issue.getByLabel("Проект", { exact: true }).click();
    await page.getByRole("button", { name: "124 · Действующий проект", exact: true }).click();
    await issue.getByLabel("Изделие проекта", { exact: true }).click();
    await page.getByRole("button", { name: "124.1 · Шкаф", exact: true }).click();
    await issue.getByLabel("Количество · Дуб", { exact: true }).fill("2,5");
    await issue.getByRole("button", { name: "Рассчитать выдачу", exact: true }).click();
    await expect(issue.getByText(/остаток склада 7 → 4,5/)).toBeVisible();
    await issue.getByRole("button", { name: "Подтвердить выдачу", exact: true }).click();
    await expect(issue).toHaveCount(0);
    const issued = await page.evaluate(() => window.expenseIssueApplied);
    assert.equal(issued.paymentId, "payment-real-id-4");
    assert.equal(issued.projectId, "project-124");
    assert.equal(issued.productId, "product");
    assert.deepEqual(issued.lines, [{ sourceMovementId: "source-line", quantity: "2,5" }]);
    assert.equal(issued.fingerprint, "confirmed-issue");
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
