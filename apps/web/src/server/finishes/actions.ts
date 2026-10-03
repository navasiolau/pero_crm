"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/server/require-role";
import { FINISH_CATALOG_MANAGE_ROLES } from "@/lib/finish-catalog-access";
import { createFinishCore, updateFinishCore, setFinishActiveCore } from "./core";
import type { FinishMutationResult } from "./contracts";
async function mutate(input: unknown, operation: typeof createFinishCore): Promise<FinishMutationResult> {
  const session = await requireRole(FINISH_CATALOG_MANAGE_ROLES);
  const result = await operation({ id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" }, input);
  // Ошибка инвалидации не меняет уже подтверждённую запись каталога.
  if (result.ok) { try { revalidatePath("/finishes"); } catch {} }
  return result;
}
export async function createFinishAction(input: unknown) { return mutate(input, createFinishCore); }
export async function updateFinishAction(input: unknown) { return mutate(input, updateFinishCore); }
export async function setFinishActiveAction(input: unknown) { return mutate(input, setFinishActiveCore); }
