import { revalidatePath } from "next/cache";
import { deliverPostCommit } from "@/server/operations/post-commit";
import { prisma } from "@/lib/prisma";

// Инвалидация страниц изделия. Ошибка одного пути не скрывает подтверждённую запись.
export async function revalidateProductPaths(productId: string | null | undefined): Promise<void> {
  if (!productId) return;
  await deliverPostCommit("product-cache", productId, [
    { kind: "cache", run: () => revalidatePath("/products") },
    { kind: "cache", run: async () => {
      const product = await prisma.product.findUnique({ where: { id: productId }, select: { number: true, projectId: true } });
      if (!product) return;
      await deliverPostCommit("product-cache", productId, [
        { kind: "cache", run: () => revalidatePath(`/products/${product.number}`) },
        { kind: "cache", run: () => revalidatePath(`/projects/${product.projectId}`) },
      ]);
    } },
  ]);
}
