"use server";

import type { ListSection } from "@/lib/list-state";
import { requireFinance } from "./require-role";
import { listPreferences } from "./list-preferences";

// Владелец определяется только auth() внутри сервиса; клиент его не передаёт.
export async function saveListPreference(section: ListSection, query: string, expected: string | null) {
  if (section === "organizationExpenses") await requireFinance();
  return listPreferences.save(section, query, expected);
}
