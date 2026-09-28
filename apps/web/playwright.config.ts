import { defineConfig } from "@playwright/test";

// Сервер запускается отдельно с явно проверенной тестовой БД, не из .env проекта.
const baseURL = process.env.CRM_E2E_BASE_URL ?? "http://localhost:3104";
const target = new URL(baseURL);
if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) && process.env.CRM_E2E_STAGING !== "1") {
  throw new Error("Для нелокального URL необходим явный CRM_E2E_STAGING=1 после проверки окружения.");
}

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, browserName: "chromium", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "mobile-360", use: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true } },
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
