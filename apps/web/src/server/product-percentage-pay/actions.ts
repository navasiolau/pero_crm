"use server";

import type { ProductPercentageKind } from "@prisma/client";
import { auth } from "@/auth";
import { MANAGER_ROLES, hasAnyRole } from "@/lib/roles";
import type { DomainActor } from "@/server/projects/core";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { configureProductPercentageCore, setProductNoModelCore, settlePendingProductPercentage, transferProductPercentageCore } from "./core";

async function actor(): Promise<DomainActor> {
  const session = await auth();
  if (!session?.user) throw new Error("Не авторизован");
  return { id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" };
}
async function answer<T>(productId: string, operation: () => Promise<T>): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  try {
    const result = await operation();
    await revalidateProductPaths(productId).catch(() => {});
    return { ok: true, result };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Не удалось сохранить настройки изделия" }; }
}

export async function configureProductPercentageAction(input: { productId: string; kind: ProductPercentageKind;
  ratePercent: string | null; participants: { userId: string; shareUnits: number }[]; expectedRevision: number;
  installationWorkIds?: string[]; reviewedLegacyWorks?: boolean }) {
  const user = await actor();
  return answer(input.productId, () => withTaskTransaction((tx) => configureProductPercentageCore(user, input, tx)));
}

export async function transferProductPercentageShareAction(input: { productId: string; kind: ProductPercentageKind;
  toUserId: string; percentOfOwnShare: string; expectedRevision: number }) {
  const user = await actor();
  return answer(input.productId, () => withTaskTransaction((tx) => transferProductPercentageCore(user, input, tx)));
}

export async function setProductNoModelAction(input: { productId: string; noModel: boolean }) {
  const user = await actor();
  return answer(input.productId, () => withTaskTransaction((tx) => setProductNoModelCore(user, input.productId, input.noModel, tx)));
}

export async function retryProductPercentageAction(input: { productId: string; kind: ProductPercentageKind }) {
  const user = await actor();
  if (!hasAnyRole(user.roles, MANAGER_ROLES)) return { ok: false as const, error: "Недостаточно прав" };
  return answer(input.productId, () => settlePendingProductPercentage(input.productId, input.kind));
}
