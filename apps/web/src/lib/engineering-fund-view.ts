import type { ProductStatus, TaskStatus } from "@prisma/client";

export type EngineeringTaskView = {
  id: string; title: string; status: TaskStatus; assigneeId: string | null; assigneeName: string | null;
  quantity: string | null; units: number | null; revision: number; amount: string | null;
};
export type EngineeringWorkView = {
  id: string; title: string; quantity: string; weightUnits: number; amount: string | null; tasks: EngineeringTaskView[];
};
export type EngineeringFundView = {
  productId: string; poolId: string | null; revision: number; productStatus: ProductStatus;
  state: "ABSENT" | "DRAFT" | "SETTLED" | "LEGACY_PROTECTED";
  primaryEngineerId: string | null; priceBasis: string | null; productCurrency: string;
  ratePercent: string | null; amount: string | null; currency: string | null; previewReason: string | null;
  closedAt: string | null; canClose: boolean; works: EngineeringWorkView[];
  candidates: { id: string; title: string; quantity: string; disabledReason: string | null; tasks: EngineeringTaskView[] }[];
};

/** Точные четыре знака процентов: 0,0001% = одна единица доли. */
export function percentToStageUnits(value: string): number {
  const text = value.trim().replace(",", ".");
  const match = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(text);
  if (!match) throw new Error("Укажите процент от 0 до 100, не более четырёх знаков после запятой");
  const units = Number(match[1]) * 10_000 + Number((match[2] ?? "").padEnd(4, "0"));
  if (units > 1_000_000) throw new Error("Доля должна быть от 0 до 100 процентов");
  return units;
}
