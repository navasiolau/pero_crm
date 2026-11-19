"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireFinance } from "@/server/require-role";
import { withMutationTransaction } from "@/server/transactions/coordinator";
import { confirmMutation } from "@/server/operations/confirmation";
import { deliverPostCommit } from "@/server/operations/post-commit";
import { dispatchEvent } from "@/server/plugins/events";
import { revalidateWarehouse } from "./revalidate";
import { ExpenseReceiptConflict, loadExpenseReceiptPreview, postExpenseReceiptInTransaction, readExpenseReceipt } from "./expense-receipt-core";
import { expenseReceiptPreviewSchema, expenseReceiptSchema } from "./expense-receipt-contracts";

async function currentActor() {
  const { user } = await requireFinance();
  return { id: user.id, name: user.name ?? "", roles: user.roles, source: "web" as const };
}

export async function previewExpenseReceipt(input: unknown) {
  const actor = await currentActor();
  const parsed = expenseReceiptPreviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Укажите материал, количество и сумму для каждой строки" };
  try {
    const result = await prisma.$transaction(tx => loadExpenseReceiptPreview(tx, actor, parsed.data));
    return { ok: true as const, fingerprint: result.fingerprint, actorId: actor.id,
      lines: result.lines, projectNumber: result.payment.project?.number ?? null };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : "Не удалось проверить оприходование" };
  }
}

export async function applyExpenseReceipt(input: unknown, expectedActorId: string) {
  const actor = await currentActor();
  const parsed = expenseReceiptSchema.safeParse(input);
  if (!parsed.success || actor.id !== expectedActorId) return { ok: false as const, retry: false,
    error: "Данные запроса или учётная запись изменились. Обновите предпросмотр." };
  const data = parsed.data;
  const result = await confirmMutation(withMutationTransaction, tx => postExpenseReceiptInTransaction(tx, actor, data),
    async (tx, candidate) => {
      let confirmed;
      try { confirmed = await readExpenseReceipt(tx, actor, data); }
      catch (error) { if (!candidate && error instanceof ExpenseReceiptConflict) return null; throw error; }
      if (!confirmed) return null;
      if (candidate) return candidate.receiptId === confirmed.id ? candidate : null;
      return { receiptId: confirmed.id, projectId: null, eventIds: [], repeated: true };
    });
  if (result.outcome === "UNKNOWN") return { ok: false as const, retry: true,
    error: "Не удалось подтвердить оприходование. Повторите тот же запрос." };
  if (result.outcome === "ROLLED_BACK") return { ok: false as const, retry: false,
    error: result.error instanceof Error ? result.error.message : "Оприходование не проведено" };
  const { receiptId, projectId, eventIds } = result.value;
  await deliverPostCommit("expense-receipt", receiptId, [
    ...eventIds.map(id => ({ kind: "dispatch" as const, run: () => dispatchEvent(id) })),
    { kind: "cache", run: () => revalidateWarehouse(null, projectId) },
    ...["/finance/expenses", "/finance/projects", "/finance/accounts/report", "/changelog"]
      .map(path => ({ kind: "cache" as const, run: () => revalidatePath(path) })),
  ]);
  return { ok: true as const, receiptId };
}
