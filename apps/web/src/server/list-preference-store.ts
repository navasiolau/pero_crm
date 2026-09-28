import type { PrismaClient } from "@prisma/client";
import type { ListPreferenceStore } from "./list-preference-service";

export function createPrismaListPreferenceStore(prisma: Pick<PrismaClient, "userPreference">): ListPreferenceStore {
  return {
    async get(userId, key) {
      return (await prisma.userPreference.findUnique({ where: { userId_key: { userId, key } } }))?.value ?? null;
    },
    async compareAndSwap(userId, key, expected, value) {
      if (expected === null) {
        const result = await prisma.userPreference.createMany({ data: { userId, key, value }, skipDuplicates: true });
        return result.count === 1;
      }
      const result = await prisma.userPreference.updateMany({ where: { userId, key, value: expected }, data: { value } });
      return result.count === 1;
    },
  };
}
