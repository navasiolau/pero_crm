// Русская плюрализация: plural(1, "изделие", "изделия", "изделий") → "изделие".
// 1 → one, 2–4 → few, 5+ → many; 11–14 → many (исключение на «-надцать»).
export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(Math.trunc(n)) % 100
  const mod10 = mod100 % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}
