import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { launchCardBrowser } from "./product-card-navigation-browser.mjs";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(web, "package.json"));
const origin = "http://telegram-finance-fixture.test";

const fixture = `
import { createRoot } from "react-dom/client";
import { FinanceNavigation } from "@/components/finance-navigation";
import { TelegramFinanceWorkspace } from "@/components/telegram-finance-workspace";
import { PageNavigationProvider } from "@/components/page-navigation-provider";
import { AccountsView } from "@/app/(app)/finance/accounts/accounts-view";
import { LogisticsWorkspace } from "@/components/logistics/workspace";
import { OrganizationExpenseToolbar } from "@/components/organization-expense-toolbar";
import { PageHeader } from "@/components/page-header";
import { ListParamsProvider } from "@/lib/list-params";

const accounts = [
  { id: "cash", name: "Основная касса", currency: "BYN", active: true, balance: 2530, comment: "Операционные расходы", isDefault: true },
  { id: "reserve", name: "Резервная касса", currency: "USD", active: true, balance: 1400, comment: "Остаток на начало месяца" },
  ...Array.from({length: 12}, (_, i) => ({ id: "cash-" + i, name: "Касса №" + i, currency: "BYN", active: true, balance: 300 + i })),
];
const trip = {
  mode: "documents", id: "trip-123456789", date: "2026-11-18", ttnNotRequired: false,
  projects: [{ id: "demo-project", number: "П-142" }],
  documents: [{ id: "sample-document", source: "logistics", fileName: "ТТН-142.pdf", mimeType: "application/pdf",
    stage: "ISSUED", ttnNumber: "142", size: 256, createdAt: "2026-11-18T09:00:00Z" }],
};
const projectId = "11111111-2222-4333-8111-111111111111";
const productId = "11111111-2222-4333-8111-111111111112";
const managedTrip = { ...trip, mode: "manage", revision: 1, comment: "", lines: [],
  shares: [{ id: "sample-share", projectId, projectNumber: "П-142", projectTitle: "Демонстрационный проект", percentBps: 10000 }],
  money: { current: null, history: [] }
};

const pathname = window.location.pathname;
const role = new URLSearchParams(window.location.search).get("role");
const allowPayroll = role !== "procurement";
const telegram = !new URLSearchParams(window.location.search).has("web");
const logisticsQuery = { query: "", page: 1, pageSize: 20, direction: "desc" };
const logistics = role === "admin" || role === "procurement" ? {
  mode: "manage", canDelete: role === "admin", total: 1, rows: [managedTrip], initialTrip: null, query: logisticsQuery,
  options: { projects: [{ id: projectId, number: "П-142", title: "Демонстрационный проект",
    products: [{ id: productId, number: "П-142-1", title: "Стол", quantity: 1 }] }], materials: [] },
  moneyOptions: { cashAccounts: [] }, budget: null,
} : { mode: "documents", total: 1, rows: [trip], initialTrip: null, query: logisticsQuery };
const expenseOptions = { purpose: [], cash: [{value:"cash",label:"Основная касса"}], article: [{value:"material",label:"Материалы"}],
  currency: [{value:"BYN",label:"BYN"}], documentPresence: [], material: [], stockUnit: [] };
const content = pathname === "/finance/accounts" ?
  <AccountsView accounts={accounts} canManageDefault={false} defaultCashAccount={{ cashAccountId: "cash", cashAccountName: "Основная касса" }} /> :
  pathname === "/finance/income" ? <PageHeader title="Приходы организации" /> :
  pathname === "/finance/expenses" ?
    <div className="flex flex-col gap-4">
      <PageHeader title="Расходы организации" />
      <ListParamsProvider section="organizationExpenses" initialQuery="" preference={null}>
        <OrganizationExpenseToolbar options={expenseOptions} />
      </ListParamsProvider>
    </div> :
  pathname === "/logistics" ?
    <LogisticsWorkspace data={logistics} /> :
    <FinanceNavigation telegram={telegram} showPayroll={allowPayroll} />;
document.documentElement.style.setProperty("--tg-content-safe-area-inset-bottom", "16px");
document.documentElement.style.setProperty("--tg-viewport-stable-height", "340px");
if (new URLSearchParams(window.location.search).has("dark")) document.documentElement.classList.add("dark");
const page = <PageNavigationProvider scope="demo" home="/finance">{content}</PageNavigationProvider>;
createRoot(document.getElementById("root")).render(telegram
  ? <TelegramFinanceWorkspace>{page}</TelegramFinanceWorkspace>
  : <main>{page}</main>);
`;

const boundaries = {
  "next/link": "export default function Link({ children, replace, onNavigate, ...props }) { return <a {...props}>{children}</a>; }",
  "next/script": "export default function Script() { return null; }",
  "next/navigation": `
    export const usePathname = () => window.location.pathname;
    export const useSearchParams = () => new URLSearchParams(window.location.search);
    export const useRouter = () => ({ refresh() {}, replace(path) { window.history.replaceState(null, "", path); } });
  `,
  "@/server/finance/actions": `
    export async function addCashAccount(input) { window.demoCash = input; return { ok: true }; }
    export async function toggleCashAccount() { throw Error("Изменение недоступно в тесте"); }
    export async function setDefaultCashAccount() { throw Error("Изменение недоступно в тесте"); }
  `,
  "@/server/logistics/actions": `
    export async function createLogisticsTrip(input) {
      window.createdLogisticsTrip = input;
      return { ok: true, tripId: "created-trip", revision: 1 };
    }
    export async function updateLogisticsTrip() { throw new Error("Редактирование недоступно в тесте"); }
  `,
  "@/server/logistics/money-actions": "export const postLogisticsTrip = async () => {}; export const correctLogisticsTripPosting = async () => {};",
  "@/server/logistics/delete-actions": `
    export async function deleteLogisticsTrip(input) {
      window.deletedLogisticsTrip = input;
      return { ok: true, tripId: input.tripId };
    }
  `,
  "@/server/list-preferences-actions": "export const saveListPreference = async () => ({ ok: true, value: null });",
};

async function assertFits(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth === window.innerWidth), true);
}

async function assertDock(page) {
  const navigation = page.getByRole("navigation", { name: "Рабочие разделы" });
  await expect(navigation).toHaveCSS("position", "fixed");
  const dock = await navigation.boundingBox();
  assert.ok(dock);
  assert.ok(Math.abs(dock.y + dock.height - page.viewportSize().height) < 2, "Панель остаётся у нижнего края");
  const button = await page.getByRole("navigation").getByRole("link", { name: "Логистика" }).boundingBox();
  assert.ok(button.height >= 44);
  assert.ok(button.y + button.height <= page.viewportSize().height - 16);
}

test("Mini App показывает полный финансовый вход, карточки, формы и ТТН на телефоне", { timeout: 60000 }, async () => {
  const { build } = createRequire(require.resolve("tsx/package.json"))("esbuild");
  const built = await build({
    stdin: { contents: fixture, loader: "tsx", resolveDir: web },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "telegram-finance-fixture", setup(builder) {
      builder.onResolve({ filter: /^(next\/|@\/server\/)/ }, ({ path }) =>
        Object.hasOwn(boundaries, path) ? { path, namespace: "telegram-finance-fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "telegram-finance-fixture" }, ({ path }) =>
        ({ contents: boundaries[path], loader: "tsx", resolveDir: web }));
    } }],
  });

  const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss");
  const cssPath = path.join(web, "src/app/globals.css");
  const baseCss = await postcss([require("@tailwindcss/postcss")({ base: web })])
    .process(await readFile(cssPath, "utf8"), { from: cssPath });
  const css = baseCss.css + "\n" + await readFile(path.join(web, "src/app/telegram/finance/workspace.css"), "utf8");
  const screenshotDirectory = process.env.PERO_TELEGRAM_MOBILE_QA_DIR;
  if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
  const browser = await launchCardBrowser();

  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, acceptDownloads: true });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route(origin + "/**", route => {
      const url = new URL(route.request().url());
      switch (url.pathname) {
        case "/workspace.css": return route.fulfill({ contentType: "text/css", body: css });
        case "/workspace.js": return route.fulfill({ contentType: "text/javascript", body: built.outputFiles[0].text });
        case "/api/logistics/documents/sample-document": return route.fulfill({ contentType: "text/plain", body: "Файл для проверки просмотра" });
        default: return route.fulfill({ contentType: "text/html; charset=utf-8", body:
          '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/workspace.css"><div id="root"></div><script src="/workspace.js"></script></html>' });
      }
    });

    await page.goto(origin + "/finance");
    const main = page.getByRole("main");
    const nav = page.getByRole("navigation", { name: "Рабочие разделы" });
    await expect(main.getByRole("heading", { name: "Финансы", level: 1 })).toBeVisible();
    await expect(main.getByRole("link")).toHaveCount(8);
    await expect(nav.getByRole("link")).toHaveCount(2);
    await expect(nav.getByRole("link", { name: "Финансы" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "Уведомления" })).toHaveCount(0);
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 780 });
      await assertFits(page);
      await assertDock(page);
    }
    if (screenshotDirectory) await page.screenshot({ path: path.join(screenshotDirectory, "finance.png") });

    await main.getByRole("link", { name: "Приходы", exact: true }).click();
    await expect(main.getByRole("heading", { name: "Приходы организации" })).toBeVisible();
    await assertDock(page);
    await nav.getByRole("link", { name: "Финансы" }).click();
    await main.getByRole("link", { name: "Кассы", exact: true }).click();
    const card = main.locator('[data-slot="mobile-list-card"]').filter({ hasText: "Основная касса" });
    await expect(card).toBeVisible();
    await expect(main.getByRole("table")).toBeHidden();
    await expect(card.getByRole("button", { name: "Деактивировать кассу" })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await assertDock(page);
    const search = main.getByRole("textbox", { name: "" }).first();
    await search.fill("резервная");
    await expect(main.locator('[data-slot="mobile-list-card"]')).toHaveCount(1);
    await search.clear();
    await page.evaluate(() => window.scrollTo(0, 0));

    await main.getByRole("button", { name: "Добавить кассу" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const popup = await dialog.boundingBox();
    assert.ok(popup.x >= -1 && popup.x + popup.width <= page.viewportSize().width + 1);
    assert.ok(Math.abs(popup.y + popup.height - (page.viewportSize().height - 16)) < 3);
    const fields = dialog.locator('[data-slot="input"]');
    assert.ok((await fields.first().boundingBox()).height >= 44);
    await fields.first().fill("Тестовая касса");
    await expect(fields.first()).toHaveValue("Тестовая касса");
    if (screenshotDirectory) await page.screenshot({ path: path.join(screenshotDirectory, "cash-form.png") });
    await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();

    await nav.getByRole("link", { name: "Логистика" }).click();
    await expect(nav.getByRole("link", { name: "Логистика" })).toHaveAttribute("aria-current", "page");
    await expect(main.getByRole("heading", { name: "Логистика", level: 1 })).toBeVisible();
    await expect(main.getByRole("button", { name: "Новый рейс" })).toHaveCount(0);
    await expect(main.getByRole("textbox", { name: "Поиск по проекту или ТТН" })).toBeVisible();
    await assertFits(page);
    if (screenshotDirectory) await page.screenshot({ path: path.join(screenshotDirectory, "logistics.png") });
    await main.getByRole("button", { name: "Открыть ТТН" }).click();
    await expect(page.getByRole("dialog").locator("a[download]")).toHaveAttribute("href", "/api/logistics/documents/sample-document");
    await page.getByRole("button", { name: "ТТН-142.pdf", exact: true }).click();
    const pdf = page.locator('[data-file-viewer-variant="document-fullscreen"]');
    await expect(pdf.locator("iframe")).toHaveAttribute("src", "/api/logistics/documents/sample-document?view=1");
    await expect(pdf.getByRole("button", { name: "Скачать оригинал" })).toBeVisible();
    await pdf.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(pdf).toHaveCount(0);
    await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).click();

    await page.setViewportSize({ width: 360, height: 780 });
    await nav.getByRole("link", { name: "Финансы" }).click();
    await main.getByRole("link", { name: "Расходы", exact: true }).click();
    const filters = main.getByRole("group", { name: "Фильтры расходов" });
    await expect(filters.getByRole("textbox", { name: "Поиск по расходам" })).toBeVisible();
    await assertFits(page);
    const dateFilter = filters.getByRole("button", { name: /^Дата/ });
    assert.ok((await dateFilter.boundingBox()).height >= 44);
    await expect(dateFilter.locator("[data-expense-filter-label]")).toHaveCSS("font-size", "13px");
    await dateFilter.click();
    await expect(page.locator('[data-slot="popover-content"]')).toHaveCSS("opacity", "1");
    if (screenshotDirectory) await page.screenshot({ path: path.join(screenshotDirectory, "expense-filters.png") });

    await page.goto(origin + "/logistics?role=admin");
    await assertFits(page);
    await main.getByRole("button", { name: "Новый рейс" }).click();
    const shipment = page.getByRole("dialog", { name: "Новая отгрузка" });
    await expect(shipment).toBeVisible();
    await shipment.getByRole("button", { name: "Добавить проект…" }).click();
    await page.getByRole("button", { name: "П-142 · Демонстрационный проект" }).click();
    await shipment.getByRole("button", { name: "Изделие", exact: true }).click();
    await shipment.getByText("Выберите позицию…", { exact: true }).click();
    await page.locator('[data-slot="searchable-select-option"]').filter({ hasText: "П-142-1 · Стол" }).click();
    await shipment.getByRole("checkbox", { name: "ТТН не требуется" }).click();
    await shipment.getByRole("button", { name: "Сохранить рейс", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.createdLogisticsTrip?.lines?.[0]?.productId))
      .toBe("11111111-2222-4333-8111-111111111112");

    if (await shipment.isVisible()) await shipment.getByRole("button", { name: "Закрыть", exact: true }).click();
    await main.getByRole("button", { name: /Удалить рейс/ }).click();
    const deletion = page.getByRole("dialog", { name: "Подтверждение удаления" });
    await expect(deletion).toBeVisible();
    assert.equal(await page.evaluate(() => window.deletedLogisticsTrip), undefined);
    await deletion.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.deletedLogisticsTrip?.expectedRevision)).toBe(1);
    await page.goto(origin + "/logistics?role=procurement");
    await expect(main.getByRole("button", { name: "Новый рейс" })).toBeVisible();
    await expect(main.getByRole("button", { name: /Удалить рейс/ })).toHaveCount(0);

    await page.goto(origin + "/finance?role=procurement");
    await expect(main.getByRole("link", { name: "Зарплата" })).toHaveCount(0);
    await expect(main.getByRole("link")).toHaveCount(7);
    await page.goto(origin + "/finance?dark=1");
    await expect(main.getByRole("heading", { name: "Финансы" })).toBeVisible();
    await assertFits(page);
    if (screenshotDirectory) await page.screenshot({ path: path.join(screenshotDirectory, "finance-dark.png") });
    await page.goto(origin + "/finance/accounts?web=1");
    await expect(page.getByRole("navigation", { name: "Рабочие разделы" })).toHaveCount(0);
    await expect(main.getByRole("table")).toBeVisible();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
