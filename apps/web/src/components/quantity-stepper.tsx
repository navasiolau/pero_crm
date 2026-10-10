"use client";

import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { quantityAtoms } from "@/lib/work-shares";
import { quantityInputError, stepWorkQuantity } from "@/lib/work-quantity";

// Распределение количества работы (§9): «покликать» +1/−1, «Все» —
// сколько единиц работы забирает эта задача.
export function QuantityStepper({
  value,
  onChange,
  remaining,
  unit = "шт",
  context = "allocation",
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  remaining: string; // точная decimal-строка свободного объёма, без Number-арифметики
  unit?: string;
  context?: "allocation" | "plan";
  id?: string;
}) {
  const error = quantityInputError(value);
  const current = error ? BigInt(0) : quantityAtoms(value.trim() || "0");
  const limit = quantityAtoms(remaining);

  function step(direction: 1 | -1) {
    if (!error) onChange(stepWorkQuantity(value, remaining, direction));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={!!error || limit <= BigInt(0) || current <= BigInt(1)}
          onClick={() => step(-1)}
          aria-label="Минус 1"
        >
          <Minus className="size-4" />
        </Button>
        <Input
          id={id}
          type="number"
          min="0.01"
          max={remaining}
          step="0.01"
          value={value}
          aria-invalid={!!error}
          onChange={(event) => onChange(event.target.value)}
          className="w-24 text-center"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={!!error || limit <= BigInt(0) || current >= limit}
          onClick={() => step(1)}
          aria-label="Плюс 1"
        >
          <Plus className="size-4" />
        </Button>
        {context === "allocation" ? <Button
          type="button"
          variant="secondary"
          disabled={limit <= BigInt(0)}
          onClick={() => onChange(remaining)}
        >
          Все
        </Button> : null}
      </div>
      {context === "allocation" ? <p className="text-xs text-muted-foreground">
        {limit > BigInt(0)
          ? `Свободно ${remaining} ${unit} — пусто заберёт весь остаток`
          : "Вся работа распределена между задачами"}
      </p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
