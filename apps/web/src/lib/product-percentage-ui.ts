import { PRODUCT_STATUSES } from "./product-statuses";
import type { ProductStatus, Role } from "@prisma/client";
import type { ProductPercentageKind } from "./product-percentage-pay";
import type { ProductPercentageSectionView, ProductPercentageState } from "./product-percentage-view";
import { PERCENTAGE_SHARE_UNITS } from "./product-percentage-pay";
import { MANAGER_ROLES } from "./roles";
import { decideProductPercentageStatus } from "./product-percentage-status";

export type ProductPercentageCandidate = { id: string; name: string; active: boolean; roles: readonly string[] };

const SHARE_DECIMALS = 10_000;

export function canEditProductPercentageConfig(input: {
  canManage: boolean;
  sectionCanManage: boolean;
  state: "DRAFT" | "SKIPPED_ONCE" | "PENDING_FX" | "SETTLED" | "LEGACY_PROTECTED";
}): boolean {
  return input.canManage && input.sectionCanManage && (input.state === "DRAFT" || input.state === "SKIPPED_ONCE");
}

export function needsInstallationLegacyReview(kind: ProductPercentageKind, requiresManagerReview: boolean): boolean {
  return kind === "INSTALLATION" && requiresManagerReview;
}

export function installationLegacyReviewSatisfied(requiresReview: boolean, acknowledged: boolean): boolean {
  return !requiresReview || acknowledged;
}

export function displayProductPercentageMemberAmount(
  state: ProductPercentageState,
  savedAmount: string | null,
  previewAmount: string | null,
): string | null {
  if (state === "SKIPPED_ONCE") return null;
  return savedAmount ?? (state === "DRAFT" ? previewAmount : null);
}

export function productStatusTargets(roles: readonly Role[], context: {
  from: ProductStatus;
  assignedEngineer: boolean;
  participant: boolean;
  hasB3d: boolean;
  noModel: boolean;
}): ProductStatus[] {
  if (MANAGER_ROLES.some((role) => roles.includes(role)))
    return PRODUCT_STATUSES.map((status) => status.id);
  return PRODUCT_STATUSES.map((status) => status.id).filter((to) =>
    to !== context.from && decideProductPercentageStatus([...roles], { ...context, to }).allowed,
  );
}

export function shouldRollbackProductStatus(result: { ok: boolean; error?: string; result?: unknown }): boolean {
  return !result.ok;
}

export function initialProductPercentageParticipants(
  kind: ProductPercentageKind,
  section: ProductPercentageSectionView,
  assignedEngineerId: string | null,
): { userId: string; shareUnits: number }[] {
  // members без config могут быть лишь серверной подсказкой прежнего инженера.
  // Подтверждённая конфигурация и frozen-история всегда сохраняют своих участников.
  if (section.hasConfiguration || section.state !== "DRAFT")
    return section.members.map(({ userId, shareUnits }) => ({ userId, shareUnits }));
  if (kind === "ENGINEERING") return assignedEngineerId ? [{ userId: assignedEngineerId, shareUnits: PERCENTAGE_SHARE_UNITS }] : [];
  return section.members.map(({ userId, shareUnits }) => ({ userId, shareUnits }));
}

export function addProductPercentageParticipant(
  current: readonly { userId: string; shareUnits: number }[],
  userId: string,
): { userId: string; shareUnits: number }[] {
  if (!userId || current.some((row) => row.userId === userId)) return [...current];
  return [...current, {
    userId,
    shareUnits: current.length ? 0 : PERCENTAGE_SHARE_UNITS,
  }];
}

export function transferOptionsForKind(
  kind: ProductPercentageKind,
  users: readonly ProductPercentageCandidate[],
  ownUserId: string,
): { value: string; label: string }[] {
  const role = kind === "ENGINEERING" ? "ENGINEER" : "MOUNTER";
  return users
    .filter((user) => user.active && user.id !== ownUserId && user.roles.includes(role))
    .map((user) => ({ value: user.id, label: user.name }));
}

export function toggleInstallationWorkSelection(
  currentIds: readonly string[],
  workId: string,
  checked: boolean,
  canConvert: boolean,
): string[] {
  if (!canConvert || !workId) return [...currentIds];
  if (checked) return currentIds.includes(workId) ? [...currentIds] : [...currentIds, workId];
  return currentIds.filter((id) => id !== workId);
}

export function percentageTextToShareUnits(value: string): number {
  const normalized = value.trim().replace(",", ".");
  const match = /^(0|[1-9]\d{0,2})(?:\.(\d{1,4}))?$/.exec(normalized);
  if (!match) throw new Error("Укажите долю от 0 до 100, не более четырёх знаков после запятой");
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(4, "0"));
  const units = whole * SHARE_DECIMALS + fraction;
  if (units > PERCENTAGE_SHARE_UNITS)
    throw new Error("Доля не может превышать 100 процентов");
  return units;
}

export function shareUnitsToPercentageText(units: number): string {
  if (!Number.isSafeInteger(units) || units < 0 || units > PERCENTAGE_SHARE_UNITS)
    throw new Error("Некорректная доля участника");
  return (units / SHARE_DECIMALS).toFixed(4).replace(/\.?0+$/, "");
}

export function previewProductPercentageShare(
  price: string | null,
  ratePercent: string | null,
  shareUnits: number,
): string | null {
  if (price === null || ratePercent === null || !Number.isSafeInteger(shareUnits) || shareUnits < 0 || shareUnits > PERCENTAGE_SHARE_UNITS)
    return null;
  const priceMatch = /^(0|[1-9]\d{0,11})\.(\d{2})$/.exec(price);
  const rateMatch = /^(0|[1-9]\d{0,2})(?:\.(\d{1,2}))?$/.exec(ratePercent);
  if (!priceMatch || !rateMatch) return null;
  const rateWhole = Number(rateMatch[1]);
  const rateFraction = Number((rateMatch[2] ?? "").padEnd(2, "0"));
  if (rateWhole > 100 || (rateWhole === 100 && rateFraction > 0)) return null;
  const priceCents = BigInt(priceMatch[1]) * BigInt(100) + BigInt(priceMatch[2]);
  const rateHundredths = BigInt(rateWhole * 100 + rateFraction);
  const denominator = BigInt(10_000) * BigInt(PERCENTAGE_SHARE_UNITS);
  const numerator = priceCents * rateHundredths * BigInt(shareUnits);
  const cents = (numerator + denominator / BigInt(2)) / denominator;
  return `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`;
}
