import type { LogisticsTripListInput } from "@/server/logistics/contracts";

export type SearchValues = Record<string, string | string[] | undefined>;
export function logisticsQueryFromParams(params: SearchValues) {
  const one = (key: string) => typeof params[key] === "string" ? params[key] as string : undefined;
  return {
    query: one("q") ?? "", projectId: one("projectId"), dateFrom: one("dateFrom"), dateTo: one("dateTo"),
    page: one("page") ?? "1", pageSize: one("pageSize") ?? "20", direction: one("direction") ?? "desc",
  };
}
export function logisticsQueryUrl(pathname: string, current: string, query: LogisticsTripListInput, changes: Record<string, string | number | undefined>) {
  const params = new URLSearchParams(current);
  const values = { q: query.query, projectId: query.projectId, dateFrom: query.dateFrom, dateTo: query.dateTo,
    page: query.page, pageSize: query.pageSize, direction: query.direction, ...changes };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === "") params.delete(key);
    else params.set(key, String(value));
  }
  return pathname + "?" + params.toString();
}
export function percentBps(value: string): number {
  const cleaned = value.trim().replace(",", ".");
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(cleaned)) return 0;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function percentLabel(bps: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(bps / 100) + "%";
}
export function normalizedMoney(value: string): string | null {
  const cleaned = value.trim().replace(",", ".");
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  return cents > BigInt(0) ? (cents / BigInt(100)).toString() + "." + (cents % BigInt(100)).toString().padStart(2, "0") : null;
}
// Предварительный расчёт только в валюте кассы; BYN берётся из серверного проведения.
export function previewAllocations(amount: string, shares: { projectId: string; percentBps: number }[]): Map<string, string> {
  const normalized = normalizedMoney(amount);
  if (!normalized || shares.reduce((sum, share) => sum + share.percentBps, 0) !== 10000 || shares.some(share => share.percentBps < 1))
    return new Map();
  const cents = BigInt(normalized.replace(".", ""));
  const parts = shares.map(share => {
    const weighted = cents * BigInt(share.percentBps);
    return { projectId: share.projectId, cents: weighted / BigInt(10000), remainder: weighted % BigInt(10000) };
  });
  let remaining = cents - parts.reduce((sum, part) => sum + part.cents, BigInt(0));
  for (const part of [...parts].sort((a, b) => a.remainder === b.remainder
    ? a.projectId.localeCompare(b.projectId) : a.remainder > b.remainder ? -1 : 1)) {
    if (remaining === BigInt(0)) break;
    part.cents += BigInt(1); remaining -= BigInt(1);
  }
  return new Map(parts.map(part => [part.projectId, (part.cents / BigInt(100)).toString() + "." + (part.cents % BigInt(100)).toString().padStart(2, "0")]));
}
export function shipmentToday(): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return part("year") + "-" + part("month") + "-" + part("day");
}
