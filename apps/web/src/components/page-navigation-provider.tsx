"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { isCrmPage, resolvePageBack, visitPage, type PageDestination, type PageVisit } from "@/lib/page-navigation";

type NativeEntry = { key: string; index: number; url: string | null };
type TabWindow = Window & { navigation?: { currentEntry: NativeEntry | null; entries(): NativeEntry[] } };
type ReturnEvent = { preventDefault(): void };
type NavigationState = {
  pathname: string;
  home: string;
  previous: string | null;
  goBack: (href: string, event: ReturnEvent) => void;
};
const Navigation = createContext<NavigationState | null>(null);

export function PageNavigationProvider({ scope, home, children }: { scope: string; home: string; children: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const trail = useRef<PageVisit[]>([]);
  const returning = useRef<{ path: string; trail: PageVisit[] } | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);

  useLayoutEffect(() => {
    function record() {
      const { pathname: path, search: query } = window.location;
      const href = path + query;
      const history = window.history;
      const saved = history.state?.peroPageNavigation;
      const pending = returning.current;
      // Каждая запись браузера хранит свой путь по CRM, в том числе после перезагрузки.
      // Так соседние вкладки и команды браузера «Назад» и «Вперёд» независимы.
      const restored = saved?.scope === scope && Array.isArray(saved.visits)
        && saved.visits.at(-1)?.href === href && saved.visits.every((item: PageVisit | null) => isCrmPage(item?.href));
      const base = pending?.path === path ? pending.trail : restored ? saved.visits as PageVisit[] : trail.current;
      const visits = visitPage(base, { href, key: (window as TabWindow).navigation?.currentEntry?.key });
      returning.current = null;
      trail.current = visits;
      setPrevious(visits.at(-2)?.href ?? null);
      history.replaceState({ ...history.state, peroPageNavigation: { scope, visits } }, "");
    }
    record();
    window.addEventListener("popstate", record);
    return () => window.removeEventListener("popstate", record);
  }, [scope, pathname, search]);

  const goBack = useCallback((href: string, event: ReturnEvent) => {
    const path = href.split("?")[0];
    const earlier = trail.current.slice(0, -1);
    const index = earlier.map(visit => visit.href.split("?")[0]).lastIndexOf(path);
    returning.current = { path, trail: earlier.slice(0, index + 1) };
    const visit = earlier[index];
    const navigation = (window as TabWindow).navigation;
    const entry = visit?.key && navigation?.entries().find(item => item.key === visit.key);
    // Один переход через промежуточные фильтры. При прямом входе Link открывает родителя.
    if (entry && navigation?.currentEntry && entry.index < navigation.currentEntry.index && entry.url === location.origin + href) {
      event.preventDefault();
      window.history.go(entry.index - navigation.currentEntry.index);
    }
  }, []);

  return <Navigation.Provider value={{ pathname, home, previous, goBack }}>{children}</Navigation.Provider>;
}

export function usePageBack(explicit?: PageDestination) {
  const navigation = useContext(Navigation);
  const destination = navigation ? resolvePageBack(navigation.pathname, navigation.home, navigation.previous, explicit) : explicit;
  return { destination, goBack: navigation?.goBack };
}
