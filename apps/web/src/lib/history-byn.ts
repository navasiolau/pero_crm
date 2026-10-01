import { Prisma } from '@prisma/client';
export const BYN_UNAVAILABLE_REASON = 'Нет достоверного сохранённого BYN-эквивалента';
type Money = { amount: Prisma.Decimal.Value; currency?: string | null; payrollCurrency?: string | null; bynAmount?: Prisma.Decimal.Value | null };
// Настройка организации и сегодняшний курс не являются свидетельством валюты истории.
export function historicalByn(row: Money): Prisma.Decimal | null {
 if (row.bynAmount != null) return new Prisma.Decimal(row.bynAmount);
 if ((row.currency ?? row.payrollCurrency) === 'BYN') return new Prisma.Decimal(row.amount);
 return null;
}
export function sumHistoricalByn(rows: readonly Money[]): number | null {
 let sum = new Prisma.Decimal(0);
 for (const row of rows) { const amount = historicalByn(row); if (amount === null) return null; sum = sum.plus(amount); }
 return sum.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}
export function subtractByn(a: number | null, b: number | null): number | null {
 return a === null || b === null ? null : new Prisma.Decimal(a).minus(b).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}
export function sumByn(values: readonly (number | null)[]): number | null {
 if (values.some(value => value === null)) return null;
 return values.reduce<Prisma.Decimal>((sum, value) => sum.plus(value!), new Prisma.Decimal(0)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}
export function requireHistoricalByn(rows: readonly Money[]): Prisma.Decimal {
 const value = sumHistoricalByn(rows);
 if (value === null) throw new Error(BYN_UNAVAILABLE_REASON);
 return new Prisma.Decimal(value);
}
