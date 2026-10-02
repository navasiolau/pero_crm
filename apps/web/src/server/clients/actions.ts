"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";
import { withTaskTransaction } from "@/server/tasks/transaction";
import {
  createClientInTransaction, updateClientInTransaction,
  type ClientInput, type ClientBaseline,
} from "./core";

// Офисный просмотр не даёт право менять общие клиентские реквизиты.
async function actor() {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  if (!hasAnyRole(session.user.roles, MANAGER_ROLES)) throw new Error("Недостаточно прав");
  return {
    id: session.user.id, name: session.user.name ?? "",
    roles: session.user.roles, source: "web" as const,
  };
}

export async function createClient(input: ClientInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const user = await actor();
  try {
    const result = await withTaskTransaction((tx) => createClientInTransaction(tx, user, input));
    if (result.ok) {
      revalidatePath("/clients");
      revalidatePath("/projects");
    }
    return result;
  } catch {
    return { ok: false, error: "Не удалось создать клиента" };
  }
}

export async function updateClient(
  clientId: string, input: ClientInput, baseline?: ClientBaseline,
): Promise<{ ok: boolean; error?: string }> {
  const user = await actor();
  if (!baseline) return { ok: false, error: "Форма устарела — обновите карточку клиента" };
  try {
    const result = await withTaskTransaction((tx) => updateClientInTransaction(tx, user, clientId, input, baseline));
    if (result.ok && !result.noOp) revalidatePath("/clients");
    return result;
  } catch {
    return { ok: false, error: "Не удалось сохранить клиента" };
  }
}
