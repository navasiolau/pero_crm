"use client";

import { createContext, useContext } from "react";
import { resolvePageBack, type PageDestination } from "@/lib/page-navigation";

export type ReturnEvent = { preventDefault(): void };
export const PageNavigationContext = createContext<{
  pathname: string;
  home: string;
  previous: string | null;
  goBack: (href: string, event: ReturnEvent) => void;
} | null>(null);

export function usePageBack(explicit?: PageDestination) {
  const navigation = useContext(PageNavigationContext);
  const destination = navigation ? resolvePageBack(navigation.pathname, navigation.home, navigation.previous, explicit) : explicit;
  return { destination, goBack: navigation?.goBack };
}
