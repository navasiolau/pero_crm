import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Минимальная загрузка .env (zero-dep): cwd → каталог пакета. В docker
// переменные приходят через env_file — process.env уже заполнен, файл пропускаем.
function loadDotEnv(): void {
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

// Конфиг из окружения. Все три переменные обязательны для запуска.
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[config] Переменная ${name} не задана`);
    process.exit(1);
  }
  return value;
}

export const config = {
  token: required("TELEGRAM_BOT_TOKEN"),
  crmBaseUrl: (process.env.CRM_BASE_URL ?? "http://192.168.0.20").replace(/\/+$/, ""),
  crmApiToken: required("CRM_API_TOKEN"),
};
