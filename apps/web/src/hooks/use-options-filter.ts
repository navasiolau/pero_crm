"use client";
import { useMemo } from "react";

type SearchOption = { label: string; hint?: string };

// Вызывается только смонтированным содержимым списка, не закрытым trigger.
export function useOptionsFilter<O extends SearchOption>(options: readonly O[], query: string, {
  locale, searchHint = false,
}: { locale?: string; searchHint?: boolean } = {}) {
  const normalized = useMemo(() => {
    const lower = (text: string) => locale ? text.toLocaleLowerCase(locale) : text.toLowerCase();
    return options.map(option => ({ option, label: lower(option.label), hint: searchHint ? lower(option.hint ?? "") : "" }));
  }, [options, locale, searchHint]);
  return useMemo(() => {
    const text = query.trim();
    const needle = locale ? text.toLocaleLowerCase(locale) : text.toLowerCase();
    if (!needle) return options;
    return normalized.filter(item => item.label.includes(needle) || (searchHint && item.hint.includes(needle))).map(item => item.option);
  }, [normalized, options, query, locale, searchHint]);
}