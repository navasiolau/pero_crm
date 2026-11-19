"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { canAssignExpenseProject } from "@/lib/expense-project-assignment";
import { JournalReversalRefusal } from "@/server/changelog/reversal-contract";
import { deliverPostCommit } from "@/server/operations/post-commit";
import { withMutationTransaction } from "@/server/transactions/coordinator";
import { assignOrdinaryExpenseProjectInTransaction } from "./project-assignment-core";

export async function assignOrdinaryExpenseProject(input: unknown) {
  try {
    const user = (await auth())?.user;
    if (!user || !canAssignExpenseProject(user.roles)) return { ok: false as const, message: "Недостаточно прав" };
    const actor = { id: user.id, name: user.name ?? "", roles: user.roles, source: "web" as const };
    const result = await withMutationTransaction(tx => assignOrdinaryExpenseProjectInTransaction(actor, input, tx));
    if (result.changed) await deliverPostCommit("payment-project-assignment", result.id,
      result.cachePaths.map(path => ({ kind: "cache", run: () => revalidatePath(path) })));
    return { ok: true as const, changed: result.changed };
  } catch (error) {
    return { ok: false as const, message: error instanceof JournalReversalRefusal
      ? error.message : "Не удалось подтвердить изменение проекта. Обновите карточку и проверьте расход" };
  }
}
