import { pendingFinanceCommand } from "./finance-checkpoint";
import type { InlineButton } from "./tg";

export const FINANCE_RECOVERY_ACTION = "fretry";

export function financeRecoveryButtons(chatId: number, actorId: string): InlineButton[][] | undefined {
  const pending = pendingFinanceCommand(chatId, actorId);
  if (!pending) return;
  return [[{ text: "Повторить сохранение", callback_data: `${FINANCE_RECOVERY_ACTION}:${pending.input.clientMutationId}` }]];
}

export function financeSaveFailure(chatId: number, actorId: string, error: string) {
  const buttons = financeRecoveryButtons(chatId, actorId);
  const hint = buttons
    ? "Повторите сохранение кнопкой ниже."
    : "Проверьте данные перед новым подтверждением.";
  return { text: `❌ ${error}. ${hint}`, buttons };
}
