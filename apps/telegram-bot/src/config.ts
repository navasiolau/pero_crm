import { existsSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";

// Минимальная загрузка .env (zero-dep): cwd → каталог пакета. В docker
// переменные приходят через env_file — process.env уже заполнен, файл пропускаем.
function loadDotEnv(): void {
  // Recovery tests receive a complete, synthetic environment. Do not let a
  // developer .env accidentally replace any part of that isolated fixture.
  if (process.env.BOT_RECOVERY_TEST === "1") return;
  for (const dir of [process.cwd(), join(__dirname, "..")]) {
    const file = join(dir, ".env");
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
    return; // первый найденный .env
  }
}
loadDotEnv();

const TELEGRAM_PRODUCTION_ORIGIN = "https://api.telegram.org";

function isPrivateTestHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  if (isIP(host) !== 4) return false;
  const parts = host.split(".").map(Number);
  return (
    parts[0] === 127 ||
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

export function resolveTelegramApiOrigin(
  override: string | undefined,
  recoveryTest: boolean,
): string {
  if (!override) {
    if (recoveryTest) {
      throw new Error("BOT_RECOVERY_TEST=1 требует приватный TELEGRAM_API_ORIGIN");
    }
    return TELEGRAM_PRODUCTION_ORIGIN;
  }
  if (!recoveryTest) {
    throw new Error(
      "TELEGRAM_API_ORIGIN разрешён только при BOT_RECOVERY_TEST=1",
    );
  }
  let url: URL;
  try {
    url = new URL(override);
  } catch {
    throw new Error("TELEGRAM_API_ORIGIN должен быть корректным origin");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !isPrivateTestHost(url.hostname)
  ) {
    throw new Error(
      "TELEGRAM_API_ORIGIN в recovery-режиме должен быть loopback/RFC1918 origin без пути и credentials",
    );
  }
  return url.origin;
}

// Конфиг из окружения. Все три переменные обязательны для запуска.
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[config] Переменная ${name} не задана`);
    process.exit(1);
  }
  return value;
}

const recoveryTest = process.env.BOT_RECOVERY_TEST === "1";
export const config = {
  token: required("TELEGRAM_BOT_TOKEN"),
  crmBaseUrl: (process.env.CRM_BASE_URL ?? "http://192.168.0.20").replace(/\/+$/, ""),
  crmApiToken: required("CRM_API_TOKEN"),
  recoveryTest,
  telegramApiOrigin: resolveTelegramApiOrigin(
    process.env.TELEGRAM_API_ORIGIN,
    recoveryTest,
  ),
  healthFile: process.env.BOT_HEALTH_FILE ?? "/tmp/pero-telegram-bot-health.json",
};
