import { randomUUID } from "node:crypto";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createListPreferenceService } from "./list-preference-service";
import { createPrismaListPreferenceStore } from "./list-preference-store";

export const listPreferences = createListPreferenceService({
  sessionUser: async () => (await auth())?.user?.id ?? null,
  revision: randomUUID,
  store: createPrismaListPreferenceStore(prisma),
});
