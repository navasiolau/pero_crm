import type { InlineSaveController } from "./inline-save-controller";
export type ConfirmedPhoneClient = { id: string; phone: string; label?: string };
// Перед записью телефона ждём подтверждения локального выбора клиента.
// Черновик прежнего клиента затем требует явного разрешения конфликта:
// не записываем его прежнему клиенту и не переносим автоматически на нового.
export async function resolvePhoneDependency(client: Pick<InlineSaveController, "flush" | "getSnapshot">, expectedClientId: string, confirmed: () => ConfirmedPhoneClient) {
  if (!await client.flush()) return { kind: "blocked" as const, error: "Сначала сохраните выбранного клиента проекта. Ввод телефона сохранён здесь." };
  const current = confirmed();
  if (client.getSnapshot().baseline !== current.id) return { kind: "blocked" as const, error: "Дождитесь подтверждения выбранного клиента проекта." };
  if (current.id !== expectedClientId) return { kind: "conflict" as const, error: "Клиент проекта изменён", currentValue: current.phone, currentClientId: current.id, currentClientLabel: current.label };
  return { kind: "ready" as const, expectedClientId };
}
