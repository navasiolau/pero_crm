import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { publishedProjectPdfPaths } from "./project-pdf";

/** Вызывается только из запроса с подтверждённым SUCCEEDED, вне фонового worker. */
export async function revalidatePublishedProjectPdfs(db: Pick<Prisma.TransactionClient, "commercialProposal">, proposalIds: readonly string[]) {
  for (const path of await publishedProjectPdfPaths(db, proposalIds)) {
    try { revalidatePath(path); } catch { /* Выпуск уже подтверждён; следующий запрос повторит обновление cache. */ }
  }
}
