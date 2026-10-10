import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

// Данные входа и cookies не должны попадать в trace, скриншоты и отчёт.
test.use({ trace: "off", screenshot: "off", video: "off" });

async function credentials() {
  const file = process.env.CRM_LOGOUT_CREDENTIALS_FILE;
  if (!file || !isAbsolute(file)) {
    throw new Error("Нужен абсолютный путь CRM_LOGOUT_CREDENTIALS_FILE к приватному JSON с email/password.");
  }
  let value: unknown;
  try {
    value = JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("Не удалось прочитать приватный QA-файл; его содержимое не выводится.");
  }
  if (!value || typeof value !== "object" || !("email" in value) || !("password" in value)
    || typeof value.email !== "string" || typeof value.password !== "string"
    || !value.email || !value.password) {
    throw new Error("Приватный файл не содержит email/password для согласованного QA-пользователя.");
  }
  return { email: value.email, password: value.password };
}

test("первый выход сразу после входа завершает текущий сеанс", async ({ page }, testInfo) => {
  const account = await credentials();
  await page.goto("/login");
  try {
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Пароль", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
  } catch {
    // Логи Playwright могут содержать введённые значения; сохраняем их приватность.
    throw new Error("Не удалось отправить форму входа согласованного QA-пользователя.");
  }
  await expect(page.getByRole("button", { name: "Меню пользователя", exact: true })).toBeVisible({ timeout: 30_000 });

  const firstPath = new URL(page.url()).pathname;
  expect(firstPath).not.toBe("/login");
  const actions: { status: number; redirectPath: string | null }[] = [];
  let requests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) requests += 1;
  });
  page.on("response", (response) => {
    const request = response.request();
    if (request.method() !== "POST" || !request.headers()["next-action"]) return;
    const redirect = response.headers()["x-action-redirect"]?.split(";")[0];
    actions.push({ status: response.status(), redirectPath: redirect ? new URL(redirect, page.url()).pathname : null });
  });

  // Это первое действие интерфейса после redirect формы входа.
  await page.getByRole("button", { name: "Меню пользователя", exact: true }).click();
  await page.getByRole("menuitem", { name: "Выйти", exact: true }).click();
  let redirectError: unknown;
  try {
    await expect(page).toHaveURL((url) => url.pathname === "/login", { timeout: 15_000 });
  } catch (error) {
    redirectError = error;
  }

  const sessionResponse = await page.request.get("/api/auth/session");
  const session = await sessionResponse.json();
  const sessionExists = Boolean(session?.user);
  const evidence = { firstPath, finalPath: new URL(page.url()).pathname, logoutActionRequests: requests, actions, sessionExists };
  console.log(JSON.stringify(evidence));
  await testInfo.attach("logout-result", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });

  expect(sessionResponse.status()).toBe(200);
  expect(sessionExists, "После выхода действующий сеанс отсутствует").toBe(false);
  if (redirectError) throw redirectError;
  const protectedResponse = await page.request.get(firstPath, { maxRedirects: 0 });
  expect([302, 303, 307, 308, 401, 403]).toContain(protectedResponse.status());
});
