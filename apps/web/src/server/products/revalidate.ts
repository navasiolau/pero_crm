import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";

// Инвалидация страниц изделия. Адрес карточки строится по номеру
// (/products/<номер>), поэтому по одному productId инвалидируем список,
// карточку по её реальному пути и карточку проекта.
export async function revalidateProductPaths(
  productId: string | null | undefined,
) {
  if (!productId) return;
  revalidatePath("/products");
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { number: true, projectId: true },
  });
  if (!product) return;
  revalidatePath(`/products/${product.number}`);
  revalidatePath(`/projects/${product.projectId}`);
}
