import { encodeListPreference, isListSection, normalizeListQuery, resolveListState, type ListSearchParams, type ListSection } from "../lib/list-state";

export interface ListPreferenceStore {
  get(userId: string, key: string): Promise<string | null>;
  compareAndSwap(userId: string, key: string, expected: string | null, value: string): Promise<boolean>;
}

export type SaveListPreferenceResult = { ok: boolean; value: string | null };

export function createListPreferenceService(deps: {
  sessionUser: () => Promise<string | null>;
  store: ListPreferenceStore;
  revision: () => string;
}) {
  async function owner(section: ListSection) {
    const userId = await deps.sessionUser();
    if (!userId) throw new Error("Не авторизован");
    if (!isListSection(section)) throw new Error("Неизвестный раздел списка");
    return userId;
  }

  return {
    async load(section: ListSection, params: ListSearchParams) {
      const userId = await owner(section);
      const value = await deps.store.get(userId, `${section}.list`);
      const legacy = value === null ? await deps.store.get(userId, `${section}.view`) : null;
      return { query: resolveListState(section, params, value, legacy), value };
    },
    async save(section: ListSection, query: string, expected: string | null): Promise<SaveListPreferenceResult> {
      const userId = await owner(section);
      // JSON-наборы проектов длиннее scalar-параметров; превышение отклоняется целиком.
      const queryLimit = section === "projects" ? 16_384 : 4096;
      const expectedLimit = section === "projects" ? 32_768 : 8192;
      if (typeof query !== "string" || query.length > queryLimit ||
        (expected !== null && (typeof expected !== "string" || expected.length > expectedLimit))) {
        throw new Error("Некорректные параметры списка");
      }
      const key = `${section}.list`;
      const normalized = normalizeListQuery(section, query);
      if (section === "projects" && normalized.length > queryLimit) throw new Error("Некорректные параметры списка");
      const value = encodeListPreference(section, normalized, deps.revision());
      if (await deps.store.compareAndSwap(userId, key, expected, value)) return { ok: true, value };
      return { ok: false, value: await deps.store.get(userId, key) };
    },
  };
}
