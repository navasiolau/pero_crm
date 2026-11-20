import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { decodeListPreference, isEngineerFilterInitialized, isListSection, resolveListState } from "@/lib/list-state";
import { writeChangeLogInTransaction } from "@/server/changelog/writer";
import type { ListPreferenceStore } from "./list-preference-service";
import { encodedListRevision, savedListChoiceReversal } from "./list-preference-reversal";

const labels = { projects: "Проекты", products: "Изделия", organizationExpenses: "Расходы организации" } as const;
const paths = { projects: "/projects", products: "/products", organizationExpenses: "/finance/expenses" } as const;

export function createPrismaListPreferenceStore(prisma: Pick<PrismaClient, "userPreference" | "$transaction">): ListPreferenceStore {
  return {
    async get(userId, key) {
      return (await prisma.userPreference.findUnique({ where: { userId_key: { userId, key } } }))?.value ?? null;
    },
    async compareAndSwap(userId, key, expected, value, actor) {
      const section = key.slice(0, -5);
      const revision = encodedListRevision(value);
      if (!key.endsWith(".list") || !isListSection(section) || !revision) throw new Error("Некорректный выбор списка");
      return prisma.$transaction(async tx => {
        const applied = expected === null
          ? await tx.userPreference.createMany({ data: { userId, key, value }, skipDuplicates: true })
          : await tx.userPreference.updateMany({ where: { userId, key, value: expected }, data: { value, revision: { increment: 1 } } });
        if (applied.count !== 1) return false;
        const legacy = expected === null
          ? await tx.userPreference.findUnique({ where: { userId_key: { userId, key: `${section}.view` } } }) : null;
        const beforeQuery = resolveListState(section, {}, expected, legacy?.value);
        const beforeEngineerInitialized = isEngineerFilterInitialized(expected);
        const afterQuery = decodeListPreference(section, value);
        if (beforeQuery === afterQuery && beforeEngineerInitialized === isEngineerFilterInitialized(value)) return true;
        const row = await tx.savedListChoiceRevision.create({ data: { id: randomUUID(), userId, section, beforeQuery,
          beforeEngineerInitialized, afterRevision: revision } });
        await writeChangeLogInTransaction(tx, { actorType: "user", actorId: userId, actorName: actor.name, source: actor.source,
          entity: "userPreference", entityId: `${userId}:${key}`, action: "update",
          oldValue: "Предыдущий выбор списка", newValue: "Новый выбор списка",
          reversal: savedListChoiceReversal.command({ revisionId: row.id }),
        }, { entity: { label: `Настройки списка «${labels[section]}»`, href: paths[section] } });
        return true;
      });
    },
  };
}
