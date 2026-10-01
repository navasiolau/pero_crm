export type ProductPercentageKind = "ENGINEERING" | "INSTALLATION";
export const PERCENTAGE_SHARE_UNITS = 1_000_000;
export type PercentageShare = { userId: string; shareUnits: number };

export function parsePercentageRate(value: string | null): string | null {
  if (value === null) return null;
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(value)) throw new Error("Некорректная процентная ставка");
  const [whole, fraction = ""] = value.split(".");
  const result = `${whole}.${fraction.padEnd(2, "0")}`;
  if (Number(whole) > 100 || (whole === "100" && Number(fraction) > 0)) throw new Error("Ставка должна быть от 0 до 100 процентов");
  return result;
}

export function assertPercentageShares(rows: readonly PercentageShare[]): void {
  if (!rows.length) throw new Error("Назначьте участника этапа");
  if (new Set(rows.map((row) => row.userId)).size !== rows.length ||
    rows.some((row) => !row.userId || !Number.isSafeInteger(row.shareUnits) || row.shareUnits <= 0 || row.shareUnits > PERCENTAGE_SHARE_UNITS) ||
    rows.reduce((sum, row) => sum + row.shareUnits, 0) !== PERCENTAGE_SHARE_UNITS)
    throw new Error("Доли участников должны составлять ровно 100 процентов");
}

export function transferOwnPercentageShare(
  rows: readonly PercentageShare[], fromUserId: string, toUserId: string, percentOfOwnShare: string,
): PercentageShare[] {
  assertPercentageShares(rows);
  if (fromUserId === toUserId) throw new Error("Нельзя передать долю себе");
  const from = rows.find((row) => row.userId === fromUserId);
  if (!from) throw new Error("У вас нет доли этого этапа");
  const parsed = parsePercentageRate(percentOfOwnShare);
  if (!parsed) throw new Error("Укажите часть доли");
  const basisPoints = BigInt(parsed.replace(".", ""));
  if (basisPoints <= BigInt(0) || basisPoints > BigInt(10000)) throw new Error("Часть доли должна быть больше нуля и не больше 100 процентов");
  const units = Number(BigInt(from.shareUnits) * basisPoints / BigInt(10000));
  if (units <= 0 || units > from.shareUnits) throw new Error("Указанная часть доли слишком мала");
  if (basisPoints < BigInt(10000) && units === from.shareUnits) throw new Error("Частичная передача не может забрать всю долю");
  const updated = rows.map((row) => row.userId === fromUserId ? { ...row, shareUnits: row.shareUnits - units }
    : row.userId === toUserId ? { ...row, shareUnits: row.shareUnits + units } : { ...row });
  if (!updated.some((row) => row.userId === toUserId)) updated.push({ userId: toUserId, shareUnits: units });
  const nonzero = updated.filter((row) => row.shareUnits > 0);
  assertPercentageShares(nonzero);
  return nonzero;
}

/** Предпросмотр в валюте изделия без обращения к курсу и пересчёта зарплаты. */
export function calculateProductCurrencyPercentage(price: string, ratePercent: string): string {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(price)) throw new Error("Некорректная цена изделия");
  const rate = parsePercentageRate(ratePercent);
  if (rate === null) throw new Error("Ставка не задана");
  const [whole, fraction = ""] = price.split(".");
  const cents = BigInt(whole + fraction.padEnd(2, "0"));
  const basisPoints = BigInt(rate.replace(".", ""));
  const amount = (cents * basisPoints + BigInt(5000)) / BigInt(10000);
  return `${amount / BigInt(100)}.${String(amount % BigInt(100)).padStart(2, "0")}`;
}

/** Копейки распределяются методом наибольшего остатка; равенство решает userId. */
export function allocatePercentageShares(total: string, rows: readonly PercentageShare[]): (PercentageShare & { amount: string })[] {
  assertPercentageShares(rows);
  if (!/^\d{1,16}\.\d{2}$/.test(total)) throw new Error("Некорректная сумма этапа");
  const cents = BigInt(total.replace(".", ""));
  const allocated = rows.map((row) => {
    const weighted = cents * BigInt(row.shareUnits);
    return { ...row, minor: weighted / BigInt(1000000), remainder: weighted % BigInt(1000000) };
  });
  let remaining = cents - allocated.reduce((sum, row) => sum + row.minor, BigInt(0));
  const rank = [...allocated].sort((a, b) => a.remainder === b.remainder ? a.userId.localeCompare(b.userId)
    : a.remainder > b.remainder ? -1 : 1);
  for (const row of rank) { if (remaining <= BigInt(0)) break; row.minor += BigInt(1); remaining -= BigInt(1); }
  return allocated.map(({ userId, shareUnits, minor }) => ({ userId, shareUnits,
    amount: `${minor / BigInt(100)}.${String(minor % BigInt(100)).padStart(2, "0")}` }));
}
