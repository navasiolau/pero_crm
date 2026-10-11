import { CALENDAR_TIMEZONE } from "./calendar-dates";

const MONTH_PATTERN = /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/;
const formatter = new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
  timeZone: CALENDAR_TIMEZONE,
  era: "short", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function isValidPayrollMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH_PATTERN.test(value);
}

export function parsePayrollMonth(value: unknown): { year: number; month: number } {
  if (!isValidPayrollMonth(value)) throw new Error("Некорректный расчётный месяц");
  return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) };
}

function localParts(date: Date): Record<string, string> {
  if (!Number.isFinite(date.getTime())) throw new Error("Некорректная дата расчётного месяца");
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

export function payrollMonth(date: Date = new Date()): string {
  const parts = localParts(date);
  const value = `${String(localYear(parts)).padStart(4, "0")}-${parts.month}`;
  parsePayrollMonth(value);
  return value;
}

function utcWall(year: number, month: number, day = 1, hour = 0, minute = 0, second = 0): number {
  // setUTCFullYear сохраняет годы 0001–0099; Date.UTC трактует их как 1901–1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

function localYear(parts: Record<string, string>): number {
  return parts.era === "BC" ? 1 - Number(parts.year) : Number(parts.year);
}

function representedWall(instant: number): number {
  const parts = localParts(new Date(instant));
  return utcWall(localYear(parts), Number(parts.month), Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second));
}

function monthStart(year: number, month: number): Date {
  const wall = utcWall(year, month);
  const radius = 2 * 86_400_000;
  const offsets = new Set([wall - radius, wall, wall + radius].map((instant) => representedWall(instant) - instant));
  const midnights = [...offsets].map((offset) => wall - offset).filter((instant) => representedWall(instant) === wall);
  if (midnights.length) return new Date(Math.min(...midnights));

  // Исторический DST может пропустить 00:00: граница — первый реальный момент месяца.
  const target = year * 12 + month - 1;
  function ordinal(instant: number): number {
    const parts = localParts(new Date(instant));
    return localYear(parts) * 12 + Number(parts.month) - 1;
  }
  let before = wall - radius, after = wall + radius;
  if (ordinal(before) >= target || ordinal(after) !== target)
    throw new Error("Не удалось определить границу расчётного месяца");
  while (after - before > 1) {
    const middle = Math.floor((before + after) / 2);
    if (ordinal(middle) < target) before = middle; else after = middle;
  }
  return new Date(after);
}
export function payrollMonthRange(value: string): { start: Date; end: Date } {
  const { year, month } = parsePayrollMonth(value);
  return {
    start: monthStart(year, month),
    // Граница 10000-01 допустима для конца 9999-12, но не как входной ключ.
    end: monthStart(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1),
  };
}

export function shiftPayrollMonth(value: string, delta: number): string {
  const { year, month } = parsePayrollMonth(value);
  const index = year * 12 + month - 1 + delta;
  if (!Number.isSafeInteger(delta) || index < 12 || index > 9999 * 12 + 11)
    throw new Error("Расчётный месяц вне допустимого диапазона");
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`;
}