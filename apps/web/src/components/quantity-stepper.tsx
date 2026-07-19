"use client";

import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Распределение количества работы (§9): «покликать» +1/−1, «Все» —
// сколько единиц работы забирает эта задача.
export function QuantityStepper({
  value,
  onChange,
  remaining,
  unit = "шт",
}: {
  value: string;
  onChange: (value: string) => void;
  remaining: number; // сколько ещё свободно в работе (без текущей задачи)
  unit?: string;
}) {
  const num = Number(value);
  const current = Number.isFinite(num) && num > 0 ? num : 0;

  function set(next: number) {
    const clamped = Math.min(Math.max(next, 1), remaining);
    onChange(String(clamped));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={remaining <= 0 || current <= 1}
          onClick={() => set(current - 1)}
          aria-label="Минус 1"
        >
          <Minus className="size-4" />
        </Button>
        <Input
          type="number"
          min="1"
          max={remaining}
          step="1"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-24 text-center"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={remaining <= 0 || current >= remaining}
          onClick={() => set(current + 1)}
          aria-label="Плюс 1"
        >
          <Plus className="size-4" />
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={remaining <= 0}
          onClick={() => onChange(String(remaining))}
        >
          Все
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {remaining > 0
          ? `Свободно ${remaining} ${unit} — пусто заберёт весь остаток`
          : "Вся работа распределена между задачами"}
      </p>
    </div>
  );
}
