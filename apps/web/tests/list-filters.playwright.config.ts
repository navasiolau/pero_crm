import { defineConfig } from "@playwright/test";

const baseURL = process.env.CRM_E2E_BASE_URL ?? "http://localhost:3103";
const target = new URL(baseURL);
const local = ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname);
if (!local && !(target.hostname === "staging-crm.peromebel.by" && process.env.CRM_E2E_STAGING === "1")) {
  throw new Error("Only an approved local runtime or explicit staging environment is supported; production is forbidden");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "list-filters.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  outputDir: process.env.CRM_E2E_OUTPUT_DIR ?? "../../../.playwright-mcp/list-filters",
  reporter: [["list"]],
  use: { baseURL, viewport: { width: 1440, height: 900 }, trace: "on", screenshot: "only-on-failure" },
});
