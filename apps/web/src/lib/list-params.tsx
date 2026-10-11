"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { saveListPreference } from "@/server/list-preferences-actions";
import { DEFAULT_LIST_QUERY, type ListSection } from "./list-state";
import { createListSearchDraft, ListStateController, type ListStateSnapshot } from "./list-state-controller";

const ListParamsContext = createContext<{
  controller: ListStateController;
  snapshot: ListStateSnapshot;
  navigating: boolean;
} | null>(null);

// Один контроллер на страницу: фильтр-бар, таблица и переключатель вида
// объединяют быстрые изменения, а не перезаписывают URL из разных снимков.
export function ListParamsProvider({ section, initialQuery, preference, children }: {
  section: ListSection;
  initialQuery: string;
  preference: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [navigating, startTransition] = useTransition();
  const notify = useRef(() => {});
  const [controller] = useState(() => new ListStateController({
    section, query: initialQuery, preference,
    save: (query, expected) => saveListPreference(section, query, expected),
    navigate: (query) => startTransition(() => router.replace(`/${section}?${query}`, { scroll: false })),
    isCurrent: () => window.location.pathname === `/${section}`,
    onChange: () => notify.current(),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Не удалось сохранить параметры списка"),
  }));
  const [snapshot, setSnapshot] = useState(controller.getSnapshot);
  const observed = useRef(initialQuery);

  useEffect(() => {
    notify.current = () => setSnapshot(controller.getSnapshot());
    controller.start();
    const cancelPending = () => controller.cancelPending();
    window.addEventListener("popstate", cancelPending);
    return () => {
      notify.current = () => {};
      controller.stop();
      window.removeEventListener("popstate", cancelPending);
    };
  }, [controller]);

  useEffect(() => {
    // Обновление RSC без изменения URL не является навигацией и не отменяет ввод.
    if (observed.current === initialQuery) return;
    observed.current = initialQuery;
    controller.observe(initialQuery, preference);
  }, [controller, initialQuery, preference]);

  return <ListParamsContext.Provider value={{ controller, snapshot, navigating }}>{children}</ListParamsContext.Provider>;
}

export function useListParams() {
  const context = useContext(ListParamsContext);
  if (!context) throw new Error("Список должен использовать ListParamsProvider");
  const { controller, snapshot, navigating } = context;
  const get = useCallback((key: string) => new URLSearchParams(snapshot.query).get(key) ?? "", [snapshot.query]);
  const getQuery = useCallback(() => controller.getSnapshot().query, [controller]);
  const set = useCallback((updates: Record<string, string | null>) => controller.set(updates), [controller]);
  const reset = useCallback(() => controller.reset(), [controller]);
  return { get, getQuery, set, reset, query: snapshot.query, pending: snapshot.pending || navigating, revision: snapshot.revision, searchRevision: snapshot.searchRevision, canReset: snapshot.query !== DEFAULT_LIST_QUERY };
}

// Таймер появляется только вследствие ввода, эффекты синхронизации не пишут URL.
export function useListSearch() {
  const { searchRevision } = useListParams();
  const context = useContext(ListParamsContext)!;
  const { controller } = context;
  const [q, updateQ] = useState(() => new URLSearchParams(controller.getSnapshot().query).get("q") ?? "");
  const [debouncer] = useState(() => createListSearchDraft(controller));

  useEffect(() => {
    debouncer.cancel();
    // Только reset/внешняя навигация заменяет набираемый текст. Подтверждение
    // собственного поиска нормализует URL, но не удаляет пробел перед следующим словом.
    updateQ(new URLSearchParams(controller.getSnapshot().query).get("q") ?? "");
    return () => debouncer.cancel();
  }, [controller, debouncer, searchRevision]);

  const setQ = useCallback((value: string) => {
    updateQ(value);
    debouncer.queue(value);
  }, [debouncer]);

  return { q, setQ };
}
