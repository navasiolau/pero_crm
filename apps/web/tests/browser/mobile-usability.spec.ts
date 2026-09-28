import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { encode } from "@auth/core/jwt";
import { localBase, localStatePath, type MobileLocalState } from "./mobile-local";

async function noPageOverflow(page: Page) {
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth, inner: window.innerWidth,
    mobileMedia: matchMedia("(max-width: 767px)").matches }));
  expect(widths.scroll, JSON.stringify(widths)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
}

async function noDialogOverflow(page: Page) {
  expect(await page.getByRole("dialog").evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  const box = await page.getByRole("dialog").boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(page.viewportSize()!.width);
}

async function login(page: Page, role = "manager") {
  if (process.env.CRM_E2E_LOCAL_SIGNED === "1") {
    expect(process.env.CRM_E2E_BASE_URL ?? localBase).toBe(localBase);
    const state = JSON.parse(await readFile(localStatePath, "utf8")) as MobileLocalState;
    const profile = state.profiles[role];
    test.skip(!profile, `Нет существующего активного пользователя роли ${role}; fixture запрещены`);
    const cookie = await encode({ token: { id: profile!.id, roles: profile!.roles, sessionVersion: profile!.sessionVersion },
      secret: state.secret, salt: "authjs.session-token", maxAge: 1800 });
    await page.context().addCookies([{ name: "authjs.session-token", value: cookie, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
    const response = await page.request.get("/api/auth/session");
    expect((await response.json()).user?.id).toBe(profile!.id);
    return;
  }
  const email = process.env[`CRM_E2E_${role.toUpperCase()}_EMAIL`];
  const password = process.env[`CRM_E2E_${role.toUpperCase()}_PASSWORD`] ?? process.env.CRM_E2E_PASSWORD;
  if (!email || !password) throw new Error(`Нужны согласованные локальные credentials CRM_E2E_${role.toUpperCase()}_EMAIL и CRM_E2E_${role.toUpperCase()}_PASSWORD`);
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

async function entityPath(kind: "PROJECT" | "PRODUCT") {
  if (process.env.CRM_E2E_LOCAL_SIGNED === "1") {
    const state = JSON.parse(await readFile(localStatePath, "utf8")) as MobileLocalState;
    return kind === "PROJECT" ? state.projectPath : state.productPath;
  }
  const path = process.env[`CRM_E2E_${kind}_PATH`];
  const prefix = kind === "PROJECT" ? "/projects/" : "/products/";
  if (!path?.startsWith(prefix) || path.includes("?") || path.includes("#") || path.includes("..")) {
    throw new Error(`CRM_E2E_${kind}_PATH должен указывать существующую согласованную сущность ${prefix}<id>`);
  }
  return path;
}

test("login typography and targets", async ({ page }, testInfo) => {
  await page.goto("/login");
  const mobile = testInfo.project.name !== "desktop";
  await expect(page.getByRole("button", { name: "Войти", exact: true })).toBeVisible();
  const metrics = await page.evaluate(() => ({
    bodyFont: Number.parseFloat(getComputedStyle(document.body).fontSize),
    inputHeight: document.querySelector('input[name="email"]')!.getBoundingClientRect().height,
    buttonHeight: document.querySelector("button[type=submit]")!.getBoundingClientRect().height,
    fontFamily: getComputedStyle(document.body).fontFamily,
  }));
  expect(metrics.bodyFont).toBe(mobile ? 22 : 20);
  expect(metrics.inputHeight).toBeGreaterThanOrEqual(mobile ? 48 : 32);
  expect(metrics.buttonHeight).toBeGreaterThanOrEqual(mobile ? 48 : 32);
  expect(metrics.fontFamily.toLowerCase()).toContain("roboto");
  await noPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("login.png"), fullPage: false, animations: "disabled" });
});

test("navigation, filters and list cards", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/projects?view=table");
  const mobile = testInfo.project.name !== "desktop";
  await noPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("projects.png"), fullPage: false, animations: "disabled" });
  if (mobile) {
    await expect(page.getByRole("button", { name: "Фильтры", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Фильтры", exact: true }).click();
    await expect(page.getByRole("dialog").getByPlaceholder("Номер, название, клиент…")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("filters.png"), fullPage: false, animations: "disabled" });
    await page.getByRole("button", { name: "Показать результаты", exact: true }).click();
    await expect(page.locator("[data-slot=mobile-list-card]").first()).toBeVisible();
    await expect(page.getByLabel("Сортировка", { exact: true })).toBeVisible();
    await page.getByLabel("Сортировка", { exact: true }).selectOption("title:asc");
    await expect(page).toHaveURL(/sort=title/);
    await page.getByRole("button", { name: "Вперёд", exact: true }).click();
    await expect(page).toHaveURL(/page=2/);
    await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Изделия", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } else {
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("button", { name: "Фильтры", exact: true })).toBeHidden();
  }
  await page.goto("/products?view=table");
  await noPageOverflow(page);
  if (mobile) await expect(page.locator("[data-slot=mobile-list-card]").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("products.png"), fullPage: false, animations: "disabled" });
});

test("long form fits short viewport", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/projects?view=table");
  await page.getByRole("button", { name: "Проект", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: testInfo.project.name === "desktop" ? 1440 : 360, height: 420 });
  await expect.poll(async () => {
    const bounds = await dialog.boundingBox();
    return Boolean(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 420);
  }).toBe(true);
  const address = dialog.getByLabel("Адрес", { exact: true });
  await address.fill("Минск, тестовый адрес для проверки формы");
  await address.click();
  await expect(address).toBeFocused();
  await dialog.getByRole("button", { name: "Создать проект", exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: "Создать проект", exact: true })).toBeInViewport();
  await noPageOverflow(page);
  await noDialogOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("project-form-short.png"), fullPage: false, animations: "disabled" });
  await dialog.getByRole("heading").first().scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("heading").first()).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("project-form-short-top.png"), fullPage: false, animations: "disabled" });
});

test("worker kanban scroll and photo choices", async ({ page }, testInfo) => {
  if (process.env.CRM_E2E_LOCAL_SIGNED === "1") {
    const state = JSON.parse(await readFile(localStatePath, "utf8")) as MobileLocalState;
    test.skip(!state.profiles.worker?.activeTasks, "В существующей локальной БД нет назначенной активной задачи WORKER; создание fixture запрещено");
  }
  await login(page, "worker");
  await page.goto("/my");
  await page.getByRole("button", { name: "Канбан", exact: true }).click();
  const board = page.locator("[data-slot=kanban-scroll]");
  await expect(board).toBeVisible();
  const handle = board.getByRole("button", { name: /Перетащить/ }).first();
  await expect(handle).toBeVisible();
  expect(await handle.evaluate((el) => getComputedStyle(el).touchAction)).toBe("none");
  const card = board.locator("[data-slot=card]").first();
  expect(await card.evaluate((el) => getComputedStyle(el).touchAction)).not.toBe("none");
  await handle.locator("xpath=ancestor::*[@data-slot='kanban-column']").evaluate((el) => el.scrollIntoView({ block: "nearest", inline: "start", behavior: "instant" }));
  await noPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("worker-kanban.png"), fullPage: false, animations: "disabled" });
  await board.getByRole("button", { name: /^Фото/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Снять фото", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Выбрать файл", exact: true })).toBeVisible();
  await expect(dialog.locator('input[type=file][capture=environment]')).toHaveAttribute("accept", "image/*");
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "Выбрать файл", exact: true }).click();
  expect((await chooser).isMultiple()).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("worker-photo.png"), fullPage: false, animations: "disabled" });
});

test("product details, scrollable tabs and mobile editing", async ({ page }, testInfo) => {
  await login(page);
  await page.goto(await entityPath("PRODUCT"));
  await expect(page.getByRole("heading", { level: 1 }).last()).toBeVisible();
  await noPageOverflow(page);
  await page.getByRole("tab", { name: "История", exact: true }).click();
  await expect(page.getByRole("tab", { name: "История", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("combobox", { name: "Сменить статус", exact: true }).click();
  await expect(page.getByRole("option", { name: "В производстве", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Редактировать", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await noPageOverflow(page);
  await noDialogOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("product-edit.png"), fullPage: false, animations: "disabled" });
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: "Сохранить", exact: true })).toBeInViewport();
  await noDialogOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("product-edit-footer.png"), fullPage: false, animations: "disabled" });
});

test("finance form keyboard and short viewport", async ({ page }, testInfo) => {
  await login(page, "admin");
  await page.goto(await entityPath("PROJECT"));
  await page.getByRole("tab", { name: "Финансы", exact: true }).click();
  await noPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("project-long-title.png"), fullPage: false, animations: "disabled" });
  await page.getByRole("button", { name: "Добавить приход", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const amount = dialog.getByLabel("Сумма, BYN *", { exact: true });
  await expect(amount).toHaveAttribute("inputmode", "decimal");
  await amount.fill("120.50");
  if (testInfo.project.name !== "desktop") await page.setViewportSize({ width: 360, height: 420 });
  const comment = dialog.getByLabel("Комментарий", { exact: true });
  await comment.fill("Проверка доступности формы без создания платежа");
  await comment.click();
  expect(await comment.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  })).toBe(true);
  await noDialogOverflow(page);
  if (process.env.CRM_E2E_LOCAL_SIGNED === "1" && await dialog.getByText(/^Нет кассы в BYN/).count()) {
    await expect(dialog.getByRole("button", { name: "Внести приход", exact: true })).toBeDisabled();
    testInfo.annotations.push({ type: "data-limitation", description: "В существующей локальной БД нет кассы BYN: проверены предупреждение и disabled-состояние без создания кассы" });
  } else {
    await expect(dialog.getByRole("button", { name: "Внести приход", exact: true })).toBeEnabled();
  }
  await page.screenshot({ path: testInfo.outputPath("finance-comment.png"), fullPage: false, animations: "disabled" });
  await dialog.getByRole("button", { name: "Внести приход", exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("button", { name: "Внести приход", exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("finance-form.png"), fullPage: false, animations: "disabled" });
});

test("dark theme lists, navigation and filters", async ({ page }, testInfo) => {
  await login(page);
  await page.goto("/projects?view=table");
  await page.getByRole("button", { name: "Включить тёмную тему", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await noPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("projects-dark.png"), fullPage: false, animations: "disabled" });
  if (testInfo.project.name !== "desktop") {
    await page.getByRole("button", { name: "Фильтры", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("filters-dark.png"), fullPage: false, animations: "disabled" });
    await page.getByRole("button", { name: "Показать результаты", exact: true }).click();
    await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("menu-dark.png"), fullPage: false, animations: "disabled" });
    await page.getByRole("dialog").getByRole("link", { name: "Изделия", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

for (const role of ["engineer", "combined", "mounter", "worker"]) {
  test(`${role} mobile working screen`, async ({ page }, testInfo) => {
    await login(page, role);
    await page.goto(["mounter", "worker"].includes(role) ? "/my" : "/products?view=table");
    await expect(page.getByRole("heading", { level: 1 }).last()).toBeVisible();
    await noPageOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`${role}.png`), fullPage: false, animations: "disabled" });
  });
}

test("login error remains readable", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("missing@mobile-test.invalid");
  await page.getByLabel("Пароль", { exact: true }).fill("incorrect-test-password");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Неверный email или пароль" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Войти", exact: true })).toBeEnabled();
  await noPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("login-error.png"), fullPage: false, animations: "disabled" });
});
