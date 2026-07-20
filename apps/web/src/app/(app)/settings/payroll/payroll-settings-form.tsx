"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setPayrollCurrency } from "@/server/payroll/actions";

const CURRENCY_LABELS: Record<string, string> = {
  BYN: "BYN — белорусский рубль",
  RUB: "RUB — российский рубль (₽)",
  USD: "USD — доллар США ($)",
  EUR: "EUR — евро (€)",
};

// Форма настройки валюты зарплаты (§10): единая для всех начислений,
// расчётников и выплат. Менять осмысленно — прошлые записи хранят
// валюту на момент начисления.
export function PayrollSettingsForm({ currency }: { currency: string }) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(currency);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Зарплата</h1>
        <p className="text-sm text-muted-foreground">
          Общие параметры начислений и расчётников
        </p>
      </div>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-lg">Валюта зарплаты</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Единая валюта начислений и выплат</Label>
            <Select value={value} onValueChange={(next) => setValue(next ?? value)}>
              <SelectTrigger>
                <SelectValue>{CURRENCY_LABELS[value] ?? value}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CURRENCY_LABELS).map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Все начисления, расчётники и выплаты показываются в этой валюте.
              Меняйте до начала начислений: прошлые записи хранят валюту
              на момент создания.
            </p>
          </div>
          <div>
            <Button
              disabled={pending || value === currency}
              onClick={() =>
                startTransition(async () => {
                  const result = await setPayrollCurrency(value);
                  if (result.ok) {
                    toast.success("Валюта зарплаты сохранена");
                  } else {
                    toast.error(result.error ?? "Ошибка сохранения");
                  }
                })
              }
            >
              {pending ? "Сохранение…" : "Сохранить"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
