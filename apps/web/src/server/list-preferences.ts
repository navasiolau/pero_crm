import { randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { financeSessionSource, scopedFinanceAuth } from "@/server/telegram/finance-session";
import { prisma } from "@/lib/prisma";
import { createListPreferenceService } from "./list-preference-service";
import { createPrismaListPreferenceStore } from "./list-preference-store";

export const listPreferences = createListPreferenceService({
  sessionUser: async section => {
    const session = await (section === "organizationExpenses" ? scopedFinanceAuth() : auth());
    return session?.user ? { id: session.user.id, name: session.user.name ?? "", source: financeSessionSource(session) } : null;
  },
  revision: randomUUID,
  store: createPrismaListPreferenceStore(prisma),
});
