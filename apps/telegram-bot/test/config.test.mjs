import assert from "node:assert/strict";
import test from "node:test";

process.env.TELEGRAM_BOT_TOKEN = "fixture-token";
process.env.CRM_API_TOKEN = "fixture-crm-token";
process.env.TELEGRAM_API_ORIGIN = "http://127.0.0.1";
process.env.BOT_RECOVERY_TEST = "1";

const { resolveTelegramApiOrigin } = await import("../dist/config.js");

test("Telegram origin defaults to the production API", () => {
  assert.equal(resolveTelegramApiOrigin(undefined, false), "https://api.telegram.org");
});

test("Telegram origin override requires explicit recovery mode", () => {
  assert.throws(() => resolveTelegramApiOrigin("http://127.0.0.1:8080", false));
  assert.throws(() => resolveTelegramApiOrigin(undefined, true));
});

test("recovery origin accepts only origin-form loopback or RFC1918 addresses", () => {
  assert.throws(() => resolveTelegramApiOrigin("https://example.com", true));
  assert.throws(() => resolveTelegramApiOrigin("http://192.168.1.2/path", true));
  assert.throws(() => resolveTelegramApiOrigin("http://user:pass@127.0.0.1", true));
  assert.throws(() => resolveTelegramApiOrigin("http://172.15.2.3", true));
  assert.throws(() => resolveTelegramApiOrigin("http://192.169.2.3", true));
  assert.equal(resolveTelegramApiOrigin("http://127.0.0.1:8080", true), "http://127.0.0.1:8080");
  assert.equal(resolveTelegramApiOrigin("http://10.2.3.4", true), "http://10.2.3.4");
  assert.equal(resolveTelegramApiOrigin("http://172.31.2.3", true), "http://172.31.2.3");
  assert.equal(resolveTelegramApiOrigin("http://192.168.2.3", true), "http://192.168.2.3");
});
