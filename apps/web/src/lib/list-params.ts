"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

// Состояние списков (фильтры/сортировка/страница/вид) живёт в URL:
// переживает перезагрузку, делится ссылками, «назад» возвращает вид.
// Изменения — через router.replace в transition, без скачков скролла.
export function useListParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const get = useCallback(
    (key: string) => searchParams.get(key) ?? "",
    [searchParams],
  );

  const set = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, {
          scroll: false,
        });
      });
    },
    [searchParams, pathname, router],
  );

  return { get, set, pending };
}
