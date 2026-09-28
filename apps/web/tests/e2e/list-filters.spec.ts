import { expect, test, type Page } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { normalizeListQuery, type ListSection } from "../../src/lib/list-state";

const tracked = new WeakSet<Page>();
const captures = new Set<Promise<void>>();

function trackOwnWrites(page: Page, account: "MANAGER" | "OTHER") {
  const filename = process.env.CRM_E2E_OWN_WRITES;
  if (!filename || tracked.has(page)) return;
  tracked.add(page);
  page.on("pageerror", (error) => console.error("Browser page error:", error.message));
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.headers()["next-action"]) return;
    let args: unknown;
    try { args = JSON.parse(request.postData() ?? ""); } catch { return; }
    if (!Array.isArray(args) || !["projects", "products"].includes(args[0]) || typeof args[1] !== "string") return;
    const [section, query] = args as [ListSection, string];
    const requestId = `${Date.now()}-${Math.random()}`;
    appendFileSync(`${filename}.requests`, JSON.stringify({ event: "request", at: new Date().toISOString(), requestId, userId: required(`CRM_E2E_${account}_ID`), section, query, expected: args[2] }) + "\n", "utf8");
    const capture = (async () => {
      try {
        const response = await request.response();
        if (!response) throw new Error("Request did not return a response");
        let captured = false;
        for (const line of (await response.text()).split("\n")) {
          try {
            const result = JSON.parse(line.slice(line.indexOf(":") + 1));
            if (result?.ok === true && typeof result.value === "string" && JSON.parse(result.value).query === normalizeListQuery(section, query)) {
              appendFileSync(filename, JSON.stringify({ at: new Date().toISOString(), requestId, userId: required(`CRM_E2E_${account}_ID`), key: `${section}.list`, value: result.value }) + "\n", "utf8");
              captured = true;
            }
          } catch { /* RSC также содержит другие типы строк */ }
        }
        appendFileSync(`${filename}.requests`, JSON.stringify({ event: "response", at: new Date().toISOString(), requestId, status: response.status(), captured }) + "\n", "utf8");
      } catch (error) {
        appendFileSync(`${filename}.requests`, JSON.stringify({ event: "capture-error", at: new Date().toISOString(), requestId, reason: String(error) }) + "\n", "utf8");
      }
    })();
    captures.add(capture);
    void capture.finally(() => captures.delete(capture));
  });
}

async function drainActions() { await Promise.allSettled([...captures]); }
test.afterEach(drainActions);
test.afterAll(drainActions);

// Только согласованные существующие аккаунты и данные, без прямого доступа к БД.
function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} for the approved existing local/staging environment`);
  return value;
}

async function login(page: Page, account: "MANAGER" | "OTHER" = "MANAGER") {
  trackOwnWrites(page, account);
  const statePath = process.env[`CRM_E2E_${account}_STATE`];
  if (statePath) {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    await page.context().addCookies(state.cookies);
    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);
    return;
  }
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(required(`CRM_E2E_${account}_EMAIL`));
  await page.getByLabel("Пароль", { exact: true }).fill(process.env[`CRM_E2E_${account}_PASSWORD`] ?? required("CRM_E2E_PASSWORD"));
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

const query = (page: Page) => Object.fromEntries(new URL(page.url()).searchParams);

async function tableRoundTrip(page: Page) {
  await page.getByRole("button", { name: "Таблица", exact: true }).click();
  await expect(page).toHaveURL(/view=table/);
  await page.getByRole("button", { name: "Канбан", exact: true }).click();
  await expect(page).toHaveURL(/view=kanban/);
}

for (const section of ["projects", "products"] as const) {
  test(`${section}: full state survives details, menu and reload; explicit URL replaces hidden state`, async ({ page }, testInfo) => {
    await login(page);
    const configured = process.env[`CRM_E2E_${section.toUpperCase()}_QUERY`] ?? "view=table&active=0&sort=title&dir=asc&page=2&pageSize=10";
    const params = new URLSearchParams(configured);
    params.set("view", "table");
    params.set("sort", "title");
    params.set("dir", "asc");
    await page.goto(`/${section}?${params}`);
    // UI-действие с завершившимся переходом подтверждает гидратацию и сохранение.
    await page.getByRole("button", { name: "Название", exact: true }).click();
    await expect(page).toHaveURL(/dir=desc/);
    await page.getByRole("button", { name: "Название", exact: true }).click();
    await expect(page).toHaveURL(/dir=asc/);
    await page.getByRole("button", { name: "Вперёд", exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    const original = query(page);
    const entity = required(section === "projects" ? "CRM_E2E_PROJECT_PATH" : "CRM_E2E_PRODUCT_PATH");
    if (!entity.startsWith(`/${section}/`)) throw new Error("Entity path must belong to the selected list");
    await page.goto(entity);
    await page.locator(`a[href="/${section}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/${section}\\?`));
    expect(query(page)).toEqual(original);
    await page.screenshot({ path: testInfo.outputPath(`${section}-restored.png`), fullPage: true });
    await page.reload();
    expect(query(page)).toEqual(original);
    const engineer = required("CRM_E2E_ENGINEER_ID");
    await page.goto(`/${section}?engineer=${encodeURIComponent(engineer)}`);
    await expect(page.getByRole("button", { name: "Канбан", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByPlaceholder(section === "projects" ? "Номер, название, клиент…" : "Номер, название, проект, клиент…")).toHaveValue("");
    await tableRoundTrip(page);
    await page.goto("/clients");
    await page.locator(`a[href="/${section}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/${section}\\?`));
    expect(query(page)).toEqual({ view: "kanban", engineer });
  });
}

test("search resets page; reset cancels draft search and remains cleared on return", async ({ page }) => {
  await login(page);
  await page.goto("/products?view=table&page=2&pageSize=10");
  const search = page.getByPlaceholder("Номер, название, проект, клиент…");
  await search.fill(required("CRM_E2E_PRODUCT_SEARCH"));
  await expect(page).toHaveURL(/q=/);
  expect(new URL(page.url()).searchParams.has("page")).toBe(false);
  await search.fill("Устаревшее значение");
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(page).toHaveURL(/\/products\?view=kanban$/);
  await page.goto("/projects?view=kanban");
  await tableRoundTrip(page);
  await page.locator('a[href="/products"]').first().click();
  await expect(page).toHaveURL(/\/products\?view=kanban$/);
  await expect(page.getByPlaceholder("Номер, название, проект, клиент…")).toHaveValue("");
});

test("fresh login restores own state without replacing another existing account's preference", async ({ page, browser, baseURL }) => {
  if (required("CRM_E2E_OTHER_EMAIL") === required("CRM_E2E_MANAGER_EMAIL")) throw new Error("Two distinct existing accounts are required");
  const other = await browser.newContext({ baseURL });
  const otherPage = await other.newPage();
  await login(otherPage, "OTHER");
  await otherPage.goto("/products");
  await expect(otherPage).toHaveURL(/\/products\?/);
  const otherBefore = query(otherPage);
  // Зафиксировать завершение initial save существующего аккаунта до закрытия его контекста.
  if (otherBefore.view === "table") {
    await otherPage.getByRole("button", { name: "Канбан", exact: true }).click();
    await expect(otherPage).toHaveURL(/view=kanban/);
    await otherPage.getByRole("button", { name: "Таблица", exact: true }).click();
    await expect(otherPage).toHaveURL(/view=table/);
  } else await tableRoundTrip(otherPage);
  await login(page);
  const searchText = required("CRM_E2E_PRODUCT_SEARCH");
  await page.goto(`/products?view=kanban&q=${encodeURIComponent(searchText)}`);
  await tableRoundTrip(page);
  const fresh = await browser.newContext({ baseURL });
  try {
    const freshPage = await fresh.newPage();
    await login(freshPage);
    await freshPage.goto("/products");
    await expect(freshPage).toHaveURL(/q=/);
    await expect(freshPage.getByPlaceholder("Номер, название, проект, клиент…")).toHaveValue(searchText);
    await otherPage.goto("/products");
    await expect(otherPage).toHaveURL(/\/products\?/);
    expect(query(otherPage)).toEqual(otherBefore);
  } finally {
    await drainActions();
    await fresh.close();
    await other.close();
  }
});

test("leaving while a save is delayed does not bounce back to the list", async ({ page }) => {
  await login(page);
  await page.goto("/products?view=kanban");
  await tableRoundTrip(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const saving = new Promise<void>((resolve) => { entered = resolve; });
  await page.route("**/products?*", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.postData()?.startsWith('["products",')) { entered(); await gate; }
    await route.continue();
  });
  await page.getByPlaceholder("Номер, название, проект, клиент…").fill(required("CRM_E2E_PRODUCT_SEARCH"));
  await saving;
  await page.locator('a[href="/clients"]').first().click();
  await expect(page).toHaveURL(/\/clients$/);
  const completed = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/products");
  release();
  await completed;
  await expect(page).toHaveURL(/\/clients$/);
});

test("pending search is retained when status changes before debounce", async ({ page }) => {
  await login(page);
  await page.goto("/products?view=kanban");
  await tableRoundTrip(page);
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  try {
    const search = page.getByPlaceholder("Номер, название, проект, клиент…");
    await search.fill("desk");
    await page.getByRole("combobox").first().click();
    // Base UI открывает Select через timeout(0); время всё ещё меньше debounce.
    await page.clock.runFor(100);
    await page.getByRole("option", { name: "Проектирование", exact: true }).click({ timeout: 10_000 });
    await expect(search).toHaveValue("desk");
    await page.clock.runFor(350);
    await expect(page).toHaveURL((url) => url.searchParams.get("q") === "desk" && url.searchParams.get("status") === "DESIGN");
    await expect(search).toHaveValue("desk");
  } finally {
    if (!page.isClosed()) await page.clock.resume();
  }
});

test("explicit same-page return to A after B keeps controls and server query aligned", async ({ page }) => {
  await login(page);
  await page.goto("/products?view=kanban");
  await tableRoundTrip(page);
  const search = page.getByPlaceholder("Номер, название, проект, клиент…");
  await search.fill("Alpha");
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === "Alpha");
  await search.fill("Beta");
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === "Beta");
  await expect(search).toHaveValue("Beta");
  const input = await search.elementHandle();
  // Публичный router Next в dev-среде сохраняет смонтированный список;
  // page.goto() пересоздал бы контроллер и скрыл ошибку синхронизации состояния.
  await page.evaluate(() => {
    const app = window as unknown as { next: { router: { push(url: string): void } } };
    app.next.router.push("/products?view=kanban&q=Alpha");
  });
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === "Alpha");
  await expect(search).toHaveValue("Alpha");
  expect(await input!.evaluate((node) => node.isConnected)).toBe(true);
  await tableRoundTrip(page);
  await page.goto("/clients");
  await page.locator('a[href="/products"]').first().click();
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === "Alpha");
  await expect(page.getByPlaceholder("Номер, название, проект, клиент…")).toHaveValue("Alpha");
});

test("multiword search keeps a typed space across a debounce pause", async ({ page }) => {
  await login(page);
  await page.goto("/products?view=kanban");
  await tableRoundTrip(page);
  const search = page.getByPlaceholder("Номер, название, проект, клиент…");
  await search.fill("Шкаф ");
  // Дожидаемся сохранения после >300 мс, а не продолжаем ввод до debounce.
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === "Шкаф");
  await expect(search).toHaveValue("Шкаф ");
  await search.pressSequentially("спальня");
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === "Шкаф спальня");
  await expect(search).toHaveValue("Шкаф спальня");
});
