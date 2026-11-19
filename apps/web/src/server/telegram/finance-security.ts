import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_INIT_AGE_SECONDS = 120;
export const TELEGRAM_FINANCE_TTL_SECONDS = 1800;
export const TELEGRAM_FINANCE_COOKIE = "__Host-pero-telegram-finance";
export const TELEGRAM_FINANCE_LAYOUT_HEADER = "x-pero-telegram-finance-layout";

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && timingSafeEqual(a, b);

export function verifiedTelegramIdentity(raw: string, token: string, now = Math.floor(Date.now() / 1000)): string | null {
  if (!token || !raw || raw.length > 8192) return null;
  const fields = new URLSearchParams(raw);
  const names = [...fields.keys()];
  const hash = fields.get("hash");
  if (!hash || !/^[a-f0-9]{64}$/.test(hash) || new Set(names).size !== names.length) return null;
  fields.delete("hash");
  if ([...fields].some(([name, value]) => !/^[a-z][a-z0-9_]*$/.test(name) || /[\r\n]/.test(value))) return null;
  fields.sort();
  const body = [...fields].map(([key, value]) => `${key}=${value}`).join("\n");
  const key = createHmac("sha256", "WebAppData").update(token).digest();
  if (!sameBytes(createHmac("sha256", key).update(body).digest(), Buffer.from(hash, "hex"))) return null;
  const authDate = Number(fields.get("auth_date"));
  if (!Number.isSafeInteger(authDate) || authDate > now + 15 || now - authDate > MAX_INIT_AGE_SECONDS) return null;
  const chatType = fields.get("chat_type");
  if ((chatType && chatType !== "private" && chatType !== "sender") || fields.has("chat") || fields.has("receiver")) return null;
  try {
    const user: { id?: unknown; is_bot?: boolean } | null = JSON.parse(fields.get("user") ?? "null");
    return typeof user?.id === "number" && Number.isSafeInteger(user.id) && user.id > 0 && !user.is_bot ? String(user.id) : null;
  } catch {
    return null;
  }
}

export type FinanceGrant = {
  chatId: string;
  linkId: string;
  linkedAt: string;
  userId: string;
  version: number;
  expires: number;
};

const signature = (data: string, secret: string) =>
  createHmac("sha256", secret).update("pero-finance-telegram-v1:").update(data).digest();

export function signFinanceGrant(grant: FinanceGrant, secret: string): string {
  const payload = Buffer.from(JSON.stringify(grant)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function readFinanceGrant(raw: string, secret: string, now = Math.floor(Date.now() / 1000)): FinanceGrant | null {
  if (!secret || raw.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const [data, proof] = raw.split(".");
  if (!sameBytes(signature(data, secret), Buffer.from(proof, "base64url"))) return null;
  try {
    const value: Partial<FinanceGrant> | null = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (typeof value?.chatId !== "string" || typeof value.linkId !== "string" || typeof value.linkedAt !== "string" ||
        typeof value.userId !== "string" || !Number.isSafeInteger(value.version) || typeof value.expires !== "number" ||
        value.expires <= now || value.expires > now + TELEGRAM_FINANCE_TTL_SECONDS) return null;
    return value as FinanceGrant;
  } catch {
    return null;
  }
}

const pages = new Set([
  "/finance", "/finance/expenses", "/finance/income", "/finance/accounts", "/finance/accounts/report",
  "/finance/articles", "/finance/projects", "/finance/payroll", "/finance/payroll/export", "/finance/advances",
  "/finance/documents", "/logistics", "/notifications", "/api/finance/projects",
  "/api/finance/documents/upload",
]);

export function isTelegramFinancePath(path: string) {
  return pages.has(path) ||
    /^\/(?:finance\/projects|logistics|api\/(?:finance|logistics)\/documents)\/(?!upload$)[A-Za-z0-9_-]{1,128}$/.test(path);
}
