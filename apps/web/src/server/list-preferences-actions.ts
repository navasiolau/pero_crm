"use server";

import type { ListSection } from "@/lib/list-state";
import { listPreferences } from "./list-preferences";

// Владелец определяется только auth() внутри сервиса; клиент его не передаёт.
export async function saveListPreference(section: ListSection, query: string, expected: string | null) {
  return listPreferences.save(section, query, expected);
}
