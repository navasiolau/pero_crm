import { formatAmount } from "./format";

export type TaskPaymentDisplayInput = {
  workId: string | null;
  rewardAmount?: string | null;
  rewardCurrency?: string | null;
  rewardSource?: "WORK_SNAPSHOT" | "FROZEN_TASK_SNAPSHOT" | "UNAVAILABLE";
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
  if (task.rewardAmount !== null && task.rewardAmount !== undefined && task.rewardCurrency)
    return formatAmount(task.rewardAmount, task.rewardCurrency);
  return "—";
}
