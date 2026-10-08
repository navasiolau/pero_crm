import { revalidatePath } from "next/cache";
import { revalidateProductPaths } from "@/server/products/revalidate";
export async function revalidateWarehouse(productId?: string | null, projectId?: string | null) {
  for (const path of ["/warehouse","/warehouse/stock","/warehouse/items","/warehouse/movements","/projects","/products"]) revalidatePath(path);
  if (projectId) {
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/finance/projects/${projectId}`);
  }
  await revalidateProductPaths(productId);
}
