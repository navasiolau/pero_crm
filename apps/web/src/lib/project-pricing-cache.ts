import { projectPricingProjectionSchema } from "@/server/projects/patch-contract";
import type { z } from "zod";
export type ProjectPricingProjection = z.infer<typeof projectPricingProjectionSchema>;
// Версия — PostgreSQL txid того же короткого locked-снимка, не клиентские часы.
export function createProjectPricingCache(initial: ProjectPricingProjection | null) {
  let snapshot = initial;
  return {
    getSnapshot: () => snapshot,
    apply: (incoming: unknown) => {
      const parsed = projectPricingProjectionSchema.safeParse(incoming);
      if (!parsed.success) return {kind:"invalid" as const,error:"Итог не обновлён: сервер не подтвердил корректный снимок и его версию."};
      if (snapshot && BigInt(parsed.data.pricingVersion) <= BigInt(snapshot.pricingVersion)) return {kind:"stale" as const};
      snapshot = parsed.data;
      return {kind:"accepted" as const,projection:snapshot};
    },
  };
}
