import type { ProductPercentageState } from "./product-percentage-view";
import { PERCENTAGE_SHARE_UNITS } from "./product-percentage-pay";
import { previewProductPercentageShare, shareUnitsToPercentageText } from "./product-percentage-ui";
type Participant = { userId: string; shareUnits: number };
// Подтверждённая текущая цена используется только в настройке нового этапа.
// Исторические завершённые/ожидающие курс снимки остаются прежними.
export function projectedPercentagePrice(state: ProductPercentageState, snapshot: string | null, confirmed: string | null | undefined) {
  return state === "DRAFT" && confirmed !== undefined ? confirmed : snapshot;
}
export function canRebaseSuggestedParticipants(input: { state: ProductPercentageState; existingMemberCount: number; previous: readonly Participant[]; next: readonly Participant[]; participants: readonly Participant[]; shares: Readonly<Record<string, string>>; otherDirty: boolean }) {
  if (input.state !== "DRAFT" || input.existingMemberCount || input.otherDirty || JSON.stringify(input.previous) === JSON.stringify(input.next)) return false;
  const originalShares = Object.fromEntries(input.previous.map(row => [row.userId, shareUnitsToPercentageText(row.shareUnits)]));
  return JSON.stringify(input.participants) === JSON.stringify(input.previous) && JSON.stringify(input.shares) === JSON.stringify(originalShares);
}

// Предварительный итог сохраняет существующую базу: цена за штуку × ставка.
// Количество и будущие формулы №23 сюда не добавляются.
export function projectedPercentageTotal(state: ProductPercentageState, snapshot: string | null, price: string | null, rate: string | null) {
  return state === "DRAFT" ? previewProductPercentageShare(price, rate, PERCENTAGE_SHARE_UNITS) : snapshot;
}
