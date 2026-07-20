"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

// Переключатель расчётного месяца (зарплата, §10): месяц хранится
// в ?month=ГГГГ-ММ, чтобы ссылку можно было переслать.

export function monthLabel(month: string): string {
  const [year, num] = month.split("-").map(Number);
  const label = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, num - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function shiftMonth(month: string, delta: number): string {
  const [year, num] = month.split("-").map(Number);
  const date = new Date(year, num - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function MonthSwitcher({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", next);
    router.replace(`${pathname}?${params.toString()}`);
  }

  const isCurrent = month >= new Date().toISOString().slice(0, 7);

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        onClick={() => go(shiftMonth(month, -1))}
        aria-label="Предыдущий месяц"
      >
        <ChevronLeft className="size-4" />
      </Button>
      <span className="min-w-32 text-center font-medium">{monthLabel(month)}</span>
      <Button
        variant="outline"
        size="icon"
        disabled={isCurrent}
        onClick={() => go(shiftMonth(month, 1))}
        aria-label="Следующий месяц"
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
