"use server";

import { auth } from "@/auth";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { withTaskTransaction } from "@/server/tasks/transaction";

import { setProductCoverCore } from "./cover-core";

export async function setProductCover(
  productId: string,
  fileId: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Не авторизован" };
  if (!productId || !fileId || productId.length > 128 || fileId.length > 128) {
    return { ok: false, error: "Неверный файл или изделие" };
  }
  try {
    const result = await withTaskTransaction((tx) => setProductCoverCore(tx,
      { id: session.user.id, name: session.user.name, roles: session.user.roles }, productId, fileId));
    if (result.ok) await revalidateProductPaths(productId).catch(() => {});
    return result;
  } catch {
    return { ok: false, error: "Не удалось заменить обложку" };
  }
}
