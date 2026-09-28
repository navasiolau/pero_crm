import { formatAmount } from "./format";

export type TaskPaymentDisplayInput = {
  workId: string | null;
  paymentKind?: "LEGACY" | "ENGINEERING";
  shareAmount?: string | null;
  shareCurrency?: string | null;
  previewAmount?: string | null;
  previewCurrency?: string | null;
  previewReason?: string | null;
  settledSource?: boolean;
};

export function taskPaymentLabel(task: TaskPaymentDisplayInput): string {
  if (task.paymentKind === "ENGINEERING") {
    if (task.previewAmount === null || task.previewAmount === undefined || !task.previewCurrency)
      return task.previewReason ?? "Предварительная сумма пока не рассчитана";
    return `${task.settledSource ? "" : "≈ "}${formatAmount(task.previewAmount, task.previewCurrency)}`;
  }
  return task.shareCurrency ? formatAmount(task.shareAmount, task.shareCurrency)
    : task.workId ? "—" : "Без денежного начисления";
}
