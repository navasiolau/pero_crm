"use server";

import { revalidatePath } from "next/cache";
import { COUNTERPARTY_ROLES } from "@/lib/roles";
import { requireRole } from "@/server/require-role";
import { withMutationTransaction } from "@/server/transactions/coordinator";
import { createCounterpartyInTransaction, updateCounterpartyInTransaction } from "./core";
import type { CounterpartyInput, CounterpartyResult } from "./contracts";

async function actor() {
  const session = await requireRole(COUNTERPARTY_ROLES);
  return { id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" as const };
}

export async function createCounterparty(input: CounterpartyInput): Promise<CounterpartyResult> {
  const user = await actor();
  try {
    const result = await withMutationTransaction(tx => createCounterpartyInTransaction(tx, user, input));
    if (result.ok) revalidatePath("/counterparties");
    return result;
  } catch { return { ok: false, kind: "failure", error: "Не удалось создать контрагента" }; }
}

export async function updateCounterparty(id: string, input: CounterpartyInput, expectedRevision: number): Promise<CounterpartyResult> {
  const user = await actor();
  try {
    const result = await withMutationTransaction(tx => updateCounterpartyInTransaction(tx, user, id, input, expectedRevision));
    if (result.ok && !result.noOp) revalidatePath("/counterparties");
    return result;
  } catch { return { ok: false, kind: "failure", error: "Не удалось сохранить контрагента" }; }
}
