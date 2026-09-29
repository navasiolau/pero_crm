"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { withTaskTransaction } from "@/server/tasks/transaction";
import { createCompositionDraftCore, saveCompositionItemCore, deleteCompositionItemCore,
  discardCompositionDraftCore, confirmCompositionDraftCore, type CompositionActor } from "./core";
import { compositionErrorMessage } from "./errors";
import { saveCompositionFinishCore, deleteCompositionFinishCore } from "@/server/finishes/core";

async function actor(): Promise<CompositionActor> {
  const session = await auth();
  if (!session?.user) throw new Error("NOT_AUTHENTICATED");
  return { id: session.user.id, name: session.user.name ?? "", roles: session.user.roles, source: "web" };
}
async function mutation<T>(productId: string, operation: (user: CompositionActor) => Promise<T>) {
  let result: T;
  try {
    result = await operation(await actor());
  } catch (error) {
    const message = error instanceof Error ? error.message : "COMPOSITION_FAILED";
    const code = /^[A-Z][A-Z0-9_]{2,80}$/.test(message) ? message : "COMPOSITION_FAILED";
    return { ok: false as const, error: code, message: compositionErrorMessage(code) };
  }
  // Cache invalidation is best effort after commit; it must never turn a committed write into an error reply.
  try {
    const product = await prisma.product.findUnique({ where: { id: productId }, select: { number: true } });
    if (product) revalidatePath(`/products/${product.number}`);
  } catch { /* the client receives the committed result and may refresh */ }
  return { ok: true as const, result: JSON.parse(JSON.stringify(result)) as T };
}

export async function createCompositionDraft(productId: string) {
  return mutation(productId, (user) => withTaskTransaction((tx) => createCompositionDraftCore(tx, user, productId)));
}
export async function saveCompositionItem(input: Parameters<typeof saveCompositionItemCore>[2]) {
  return mutation(input.productId, (user) => withTaskTransaction((tx) => saveCompositionItemCore(tx, user, input)));
}
export async function deleteCompositionItem(input: Parameters<typeof deleteCompositionItemCore>[2]) {
  return mutation(input.productId, (user) => withTaskTransaction((tx) => deleteCompositionItemCore(tx, user, input)));
}
export async function discardCompositionDraft(input: Parameters<typeof discardCompositionDraftCore>[2]) {
  return mutation(input.productId, (user) => withTaskTransaction((tx) => discardCompositionDraftCore(tx, user, input)));
}
export async function confirmCompositionDraft(input: Parameters<typeof confirmCompositionDraftCore>[2]) {
  return mutation(input.productId, (user) => withTaskTransaction((tx) => confirmCompositionDraftCore(tx, user, input)));
}

export async function saveCompositionFinish(input: Parameters<typeof saveCompositionFinishCore>[2]) {
  return mutation(input.productId, (user) => withTaskTransaction((tx) => saveCompositionFinishCore(tx, user, input)));
}
export async function deleteCompositionFinish(input: Parameters<typeof deleteCompositionFinishCore>[2]) {
  return mutation(input.productId, (user) => withTaskTransaction((tx) => deleteCompositionFinishCore(tx, user, input)));
}
