"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAmount } from "@/lib/format";
import { productLineTotal } from "@/lib/product-quantity";

export function ProductQuantityInput({ value, onChange, price, currency, showAmount }: {
  value: string; onChange: (value: string) => void; price: string | null; currency: string; showAmount: boolean;
}) {
  let total: string | null = null;
  try { total = productLineTotal(price, Number(value)); } catch { /* Некорректный ввод исправляется до сохранения. */ }
  return <div className="flex flex-col gap-1.5">
    <Label htmlFor="product-quantity">Количество, шт.</Label>
    <Input id="product-quantity" type="number" min="1" max="2147483647" step="1" value={value} onChange={(event) => onChange(event.target.value)} />
    {showAmount && <p className="text-sm text-muted-foreground">Сумма партии: {formatAmount(total, currency)}</p>}
  </div>;
}
