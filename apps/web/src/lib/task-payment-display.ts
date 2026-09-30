import { formatAmount } from "./format";

export type TaskPaymentDisplayInput = {
  workId: string | null;
  paymentKind?: "LEGACY" | "ENGINEERING" | "INSTALLATION";
  shareAmount?: string | null;
  shareCurrency?: string | null;
  previewAmount?: string | null;
  previewCurrency?: string | null;
  previewReason?: string | null;
  settledSource?: boolean;
};

export type WorkPaymentDisplayInput = {
  paymentKind?: "LEGACY" | "ENGINEERING" | "INSTALLATION";
  priceSnapshot: string | null;
  total: string | null;
  quantity: string;
};

export function workPaymentSourceLabel(work: WorkPaymentDisplayInput): string {
  if (work.paymentKind === "INSTALLATION") return "Монтаж — процент от изделия";
  if (work.paymentKind === "ENGINEERING") return "Инженерный фонд (история)";
  return `${formatAmount(work.priceSnapshot, "BYN")} × ${work.quantity}`;
}

export function workPaymentAmountLabel(work: WorkPaymentDisplayInput): string {
  if (work.paymentKind === "INSTALLATION") return "Источник оплаты: процентный этап изделия";
  if (work.paymentKind === "ENGINEERING") return "Старая оплата по долям фонда";
  return formatAmount(work.total, "BYN");
}

export function taskPaymentLabel(task: TaskPaymentDisplayInput): string {
  if (task.paymentKind === "INSTALLATION") return "Монтаж — процент от изделия";
  if (task.paymentKind === "ENGINEERING") {
    const label = task.settledSource ? "Начислено ранее" : "Прежнее распределение (история)";
    if (task.previewAmount === null || task.previewAmount === undefined || !task.previewCurrency)
      return `${label}: ${task.previewReason ?? "сумма в исторической записи отсутствует"}`;
    return `${label}: ${task.settledSource ? "" : "≈ "}${formatAmount(task.previewAmount, task.previewCurrency)}`;
  }
  return task.shareCurrency ? formatAmount(task.shareAmount, task.shareCurrency)
    : task.workId ? "—" : "Без денежного начисления";
}
