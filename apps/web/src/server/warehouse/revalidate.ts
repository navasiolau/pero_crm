import { revalidatePath } from "next/cache";
import { revalidateProductPaths } from "@/server/products/revalidate";
import { deliverPostCommit } from "@/server/operations/post-commit";

export async function revalidateWarehouse(productId?: string | null, projectId?: string | null): Promise<void> {
  const effects: Parameters<typeof deliverPostCommit>[2] = ["/warehouse", "/warehouse/stock", "/warehouse/items", "/warehouse/movements", "/projects", "/products"]
    .map(path => ({ kind: "cache", run: () => revalidatePath(path) }));
  if (projectId) effects.push({ kind: "cache", run: () => revalidatePath(`/projects/${projectId}`) },
    { kind: "cache", run: () => revalidatePath(`/finance/projects/${projectId}`) });
  effects.push({ kind: "cache", run: () => revalidateProductPaths(productId) });
  await deliverPostCommit("warehouse-cache", productId ?? "warehouse", effects);
}
