"use client";

import { createContext, useContext, type ReactNode } from "react";

const TelegramFinanceContext = createContext(false);

export function TelegramFinanceUiScope({ children }: { children: ReactNode }) {
  return <TelegramFinanceContext.Provider value>{children}</TelegramFinanceContext.Provider>;
}

export function useTelegramFinanceUi() {
  return useContext(TelegramFinanceContext);
}
