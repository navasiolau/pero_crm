"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { WAREHOUSE_UNIT_ADMIN_ROLES } from "@/lib/roles";
import { requireRole } from "@/server/require-role";
import type { DomainActor } from "@/server/actor";
import { withWarehouseWrite } from "./accounting";
import { revalidateWarehouse } from "./revalidate";
import { materialUnitSchema, type MaterialUnitInput } from "./unit-contracts";
import { createMaterialUnitInTransaction, renameMaterialUnitInTransaction, deleteMaterialUnitInTransaction, materialUnitError } from "./unit-core";

async function mutateUnit(operation: (tx: Prisma.TransactionClient, actor: DomainActor) => Promise<unknown>): Promise<{ ok: boolean; error?: string }> {
  const session = await requireRole(WAREHOUSE_UNIT_ADMIN_ROLES);
  const actor: DomainActor = { id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" };
  try { await withWarehouseWrite(tx => operation(tx, actor)); }
  catch (error) { return { ok: false, error: materialUnitError(error) }; }
  revalidatePath("/settings/warehouse-units");
  await revalidateWarehouse();
  // Названия складских единиц используются и в финансовых расходах.
  revalidatePath("/finance", "layout");
  revalidatePath("/products", "layout");
  revalidatePath("/projects", "layout");
  return { ok: true };
}
export async function addMaterialUnit(input: MaterialUnitInput) {
  const parsed = materialUnitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  return mutateUnit((tx, actor) => createMaterialUnitInTransaction(tx, actor, parsed.data));
}
export async function renameMaterialUnit(id: string, input: MaterialUnitInput) {
  const parsed = materialUnitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Ошибка данных" };
  return mutateUnit((tx, actor) => renameMaterialUnitInTransaction(tx, actor, id, parsed.data));
}
export async function deleteMaterialUnit(id: string) {
  return mutateUnit((tx, actor) => deleteMaterialUnitInTransaction(tx, actor, id));
}
