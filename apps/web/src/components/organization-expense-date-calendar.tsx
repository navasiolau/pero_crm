"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { calendarLocalValue } from "@/lib/calendar-dates";
import { cn } from "@/lib/utils";

const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const monthFormat = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "UTC" });

function calendarDate(value: string) {
  return new Date(value + "T00:00:00Z");
}

function dateValue(date: Date) {
  const value = date.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "0001-01-01" ? value : "";
}

function moveMonth(date: Date, delta: number) {
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + delta + 1, 0);
  date.setUTCDate(Math.min(day, date.getUTCDate()));
}

export function OrganizationExpenseDateCalendar({ boundary, initialValue }: {
  boundary: "From" | "To";
  initialValue: string;
}) {
  const [today] = useState(() => calendarLocalValue(new Date()).slice(0, 10));
  const [value, setValue] = useState(initialValue);
  const [focusedDate, setFocusedDate] = useState(initialValue || today);
  const focusedButton = useRef<HTMLButtonElement>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  const moveFocus = useRef(false);

  const firstDay = calendarDate(focusedDate.slice(0, 7) + "-01");
  const firstWeekday = (firstDay.getUTCDay() + 6) % weekdays.length;
  const lastDay = calendarDate(dateValue(firstDay));
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  const heading = monthFormat.format(firstDay);
  const label = boundary === "From" ? "От" : "До";
  const dateLabel = "Дата " + label.toLowerCase();
  const clearLabel = "Очистить дату " + label.toLowerCase();

  useLayoutEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    focusedButton.current?.focus();
  }, [focusedDate]);

  function selectDate(next: string) {
    setValue(next);
    if (next >= "0001-01-01" && next <= "9999-12-31" && /^\d{4}-\d{2}-\d{2}$/.test(next)) setFocusedDate(next);
  }

  function changeMonth(delta: number) {
    const next = calendarDate(focusedDate);
    moveMonth(next, delta);
    const nextValue = dateValue(next);
    if (nextValue) setFocusedDate(nextValue);
  }

  function handleDayKey(event: KeyboardEvent<HTMLButtonElement>, date: Date) {
    const next = new Date(date);
    const day = date.getUTCDate();
    const weekday = (date.getUTCDay() + 6) % weekdays.length;
    switch (event.key) {
      case "ArrowLeft": next.setUTCDate(day - 1); break;
      case "ArrowRight": next.setUTCDate(day + 1); break;
      case "ArrowUp": next.setUTCDate(day - weekdays.length); break;
      case "ArrowDown": next.setUTCDate(day + weekdays.length); break;
      case "Home": next.setUTCDate(day - weekday); break;
      case "End": next.setUTCDate(day + weekdays.length - 1 - weekday); break;
      case "PageUp": moveMonth(next, event.shiftKey ? -12 : -1); break;
      case "PageDown": moveMonth(next, event.shiftKey ? 12 : 1); break;
      default: return;
    }
    event.preventDefault();
    const nextValue = dateValue(next);
    if (nextValue && nextValue !== focusedDate) {
      moveFocus.current = true;
      setFocusedDate(nextValue);
    }
  }

  return (
    <fieldset className="min-w-0 rounded-lg border px-2.5 pb-2">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <div className="mb-1 flex items-center gap-1">
        <Input
          ref={dateInput}
          aria-label={dateLabel}
          name={"date" + boundary}
          type="date"
          min="0001-01-01"
          max="9999-12-31"
          value={value}
          onChange={event => selectDate(event.target.value)}
        />
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={clearLabel}
            title={clearLabel}
            onClick={() => { setValue(""); dateInput.current?.focus(); }}
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
      <div className="mb-1 flex items-center justify-between gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Предыдущий месяц"
          disabled={focusedDate.startsWith("0001-01")}
          onClick={() => changeMonth(-1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span aria-live="polite" className="text-center text-sm font-medium capitalize">{heading}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Следующий месяц"
          disabled={focusedDate.startsWith("9999-12")}
          onClick={() => changeMonth(1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 justify-items-stretch text-center" role="group" aria-label={heading}>
        {weekdays.map(day => <span key={day} className="py-1 text-xs text-muted-foreground">{day}</span>)}
        {Array.from({ length: 42 }, (_, index) => {
          const day = index - firstWeekday + 1;
          if (day < 1 || day > lastDay.getUTCDate()) return <span aria-hidden key={index} className="h-8 max-md:h-9" />;
          const date = new Date(firstDay);
          date.setUTCDate(day);
          const iso = dateValue(date);
          return (
            <button
              key={index}
              type="button"
              ref={iso === focusedDate ? focusedButton : undefined}
              tabIndex={iso === focusedDate ? 0 : -1}
              data-date={iso}
              aria-label={dayFormat.format(date)}
              aria-current={iso === today ? "date" : undefined}
              aria-pressed={iso === value}
              onFocus={() => setFocusedDate(iso)}
              onClick={() => selectDate(iso)}
              onKeyDown={event => handleDayKey(event, date)}
              className={cn(
                "h-8 min-w-0 rounded-md text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-9 max-md:min-h-0! max-md:min-w-0!",
                iso === value ? "bg-primary font-semibold text-primary-foreground" : "hover:bg-muted",
                iso === today && iso !== value && "font-semibold text-primary",
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
