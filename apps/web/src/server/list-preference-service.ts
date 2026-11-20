import { decodeListPreference, encodeListPreference, isEngineerFilterInitialized, isListSection, MAX_LIST_QUERY_LENGTH, normalizeListQuery, resolveListState, type ListSearchParams, type ListSection } from "../lib/list-state";

export type ListPreferenceActor = { name: string; source: "web" | "telegram" };

export interface ListPreferenceStore {
  get(userId: string, key: string): Promise<string | null>;
  compareAndSwap(userId: string, key: string, expected: string | null, value: string, actor: ListPreferenceActor): Promise<boolean>;
}

export type SaveListPreferenceResult = { ok: boolean; value: string | null };

export function createListPreferenceService(deps: {
  sessionUser: (section: ListSection) => Promise<({ id: string } & ListPreferenceActor) | null>;
  store: ListPreferenceStore;
  revision: () => string;
}) {
  async function owner(section: ListSection) {
    if (!isListSection(section)) throw new Error("Неизвестный раздел списка");
    const user = await deps.sessionUser(section);
    if (!user) throw new Error("Не авторизован");
    return user;
  }

  return {
    async load(section: ListSection, params: ListSearchParams, options: { defaultEngineer?: boolean } = {}) {
      const { id: userId } = await owner(section);
      const value = await deps.store.get(userId, `${section}.list`);
      const legacy = value === null ? await deps.store.get(userId, `${section}.view`) : null;
      return { query: resolveListState(section, params, value, legacy, options.defaultEngineer ? userId : null), value };
    },
    async save(section: ListSection, query: string, expected: string | null): Promise<SaveListPreferenceResult> {
      const actor = await owner(section);
      const userId = actor.id;
      // Общие bounds JSON-наборов; превышение отклоняется целиком.
      const queryLimit = MAX_LIST_QUERY_LENGTH;
      const expectedLimit = 32_768;
      if (typeof query !== "string" || query.length > queryLimit ||
        (expected !== null && (typeof expected !== "string" || expected.length > expectedLimit))) {
        throw new Error("Некорректные параметры списка");
      }
      const key = `${section}.list`;
      const normalized = normalizeListQuery(section, query);
      if (normalized.length > queryLimit) throw new Error("Некорректные параметры списка");
      if (expected !== null && isEngineerFilterInitialized(expected) && decodeListPreference(section, expected) === normalized) {
        const current = await deps.store.get(userId, key);
        return { ok: current === expected, value: current };
      }
      const value = encodeListPreference(section, normalized, deps.revision());
      if (await deps.store.compareAndSwap(userId, key, expected, value, actor)) return { ok: true, value };
      return { ok: false, value: await deps.store.get(userId, key) };
    },
  };
}
