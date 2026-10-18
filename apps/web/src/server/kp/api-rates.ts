import { Prisma } from "@prisma/client";
import { apiFailure, apiRateQuery, parseApi, type KpApiContext } from "./api-contract";
import { fixedProposalRate, proposalCurrency, type ProposalFixedRate } from "./pricing-contract";

export function proposalSourceDate(state: unknown): string | null {
  if (!state || typeof state !== "object" || Array.isArray(state) || !("order" in state)) return null;
  const order = state.order;
  if (!order || typeof order !== "object" || Array.isArray(order) || !("date" in order) || typeof order.date !== "string") return null;
  const text = order.date, parts = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  const value = parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : text;
  const date = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
export function moscowDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}
export const rateDto = (rate: ProposalFixedRate) => ({ currency: rate.currency, rate: rate.value.toString(), date: rate.date, source: rate.source });

/** НБРБ вызывается до SQL mutation; ни курс, ни дата не подменяются текущими при ошибке. */
export async function fetchKpNbrbRate(context: KpApiContext, input: unknown, fetcher: typeof fetch = fetch): Promise<ProposalFixedRate> {
  const { currency, date } = parseApi(apiRateQuery, input);
  await context.authorize();
  if (currency === "BYN") return fixedProposalRate({ currency, value: "1", date, source: "NBRB" }, currency);
  const url = new URL(`https://api.nbrb.by/exrates/rates/${currency}`); url.searchParams.set("parammode", "2"); url.searchParams.set("ondate", date);
  let result: unknown;
  try {
    const response = await fetcher(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !response.body) throw Error("rate");
    const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > 32 * 1024) { await reader.cancel(); throw Error("limit"); } chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return apiFailure("KP_RATE_UNAVAILABLE", 503, "Курс НБРБ недоступен. Повторите запрос или задайте ручной курс"); }
  await context.authorize();
  if (!result || typeof result !== "object" || !("Cur_OfficialRate" in result) || !("Cur_Scale" in result) || !("Date" in result) ||
    !("Cur_Abbreviation" in result) || result.Cur_Abbreviation !== currency || typeof result.Cur_OfficialRate !== "number" ||
    typeof result.Cur_Scale !== "number" || !Number.isSafeInteger(result.Cur_Scale) || result.Cur_Scale < 1 ||
    !Number.isFinite(result.Cur_OfficialRate) || result.Cur_OfficialRate <= 0 || typeof result.Date !== "string" || result.Date.slice(0, 10) !== date)
    return apiFailure("KP_RATE_INVALID", 503, "НБРБ вернул неподходящий курс");
  return fixedProposalRate({ currency, value: new Prisma.Decimal(String(result.Cur_OfficialRate)).div(result.Cur_Scale).toDecimalPlaces(10), date, source: "NBRB" }, currency);
}

export type StoredRate = { currency: string; rate: { toString(): string } | string | null; rateDate: Date | string | null; rateSource: string | null };
export function storedKpRate(value: StoredRate): ProposalFixedRate | null {
  if (value.rate === null || value.rateDate === null || value.rateSource === null) return null;
  try { return fixedProposalRate({ currency: value.currency, value: value.rate.toString(), date: value.rateDate, source: value.rateSource }, proposalCurrency(value.currency)); }
  catch { return null; }
}
