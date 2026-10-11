"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CALENDAR_TIMEZONE } from "@/lib/calendar-dates";
import { payrollMonth, payrollMonthRange, shiftPayrollMonth } from "@/lib/payroll-month";

// Переключатель расчётного месяца (зарплата, §10): месяц хранится
// в ?month=ГГГГ-ММ, чтобы ссылку можно было переслать.

export function monthLabel(month: string): string {
  const label = new Intl.DateTimeFormat("ru-RU", {
    timeZone: CALENDAR_TIMEZONE, month: "long", year: "numeric",
  }).format(payrollMonthRange(month).start);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export const shiftMonth = shiftPayrollMonth;
export function MonthSwitcher({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("month", next);
    router.replace(`${pathname}?${params.toString()}`);
  }

  const isCurrent = month >= payrollMonth();

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        onClick={() => go(shiftMonth(month, -1))}
        disabled={month === "0001-01"}
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
