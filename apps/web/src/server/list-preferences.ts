import { randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { scopedFinanceAuth } from "@/server/telegram/finance-session";
import { createListPreferenceService } from "./list-preference-service";
import { createPrismaListPreferenceStore } from "./list-preference-store";

export const listPreferences = createListPreferenceService({
  sessionUser: async section => (await (section === "organizationExpenses" ? scopedFinanceAuth() : auth()))?.user?.id ?? null,
  revision: randomUUID,
  store: createPrismaListPreferenceStore(prisma),
});
