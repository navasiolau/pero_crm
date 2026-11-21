"use client";

import { PageHeader } from "@/components/page-header";
import { HandCoins } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAmount } from "@/lib/format";
import { CashPayoutForm } from "./cash-payout-form";

type EmployeeOption = { id: string; name: string; position: string | null };
type CashAccountOption = { id: string; name: string; currency: string; active: boolean; balance: number; isDefault?: boolean };

export function AdvancesView({ users, accounts }: { users: EmployeeOption[]; accounts: CashAccountOption[] }) {
  const availableAccounts = accounts.filter((account) => account.active);

  return (
    <div className="@container/advance-page flex w-full min-w-0 flex-col gap-6">
      <PageHeader
        title={<h1 className="flex items-center gap-2 text-2xl font-semibold"><HandCoins className="size-6" /> Выдача аванса</h1>}
        description={<p className="mt-1 text-sm text-muted-foreground">Выберите сотрудника и кассу. Сумма вводится в валюте кассы; перед выдачей проверьте эквиваленты и курсы.</p>}
      />

      <div className="grid items-start gap-6 @[960px]/advance-page:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Новая выдача</CardTitle>
            <CardDescription>Описание работы обязательно. Выдача уменьшит остаток выбранной кассы и будет учтена как аванс в зарплате.</CardDescription>
          </CardHeader>
          <CardContent>
            <CashPayoutForm mode="ADVANCE" users={users} accounts={availableAccounts} adaptiveFields />
          </CardContent>
        </Card>

        <section aria-label="Остатки активных касс" className="grid min-w-0 gap-3">
          {availableAccounts.map((account) => (
            <Card key={account.id}>
              <CardHeader className="pb-2">
                <CardTitle className="wrap-anywhere text-base">{account.name}</CardTitle>
                <CardDescription>Доступно в кассе</CardDescription>
              </CardHeader>
              <CardContent className="wrap-anywhere text-xl font-semibold">{formatAmount(account.balance, account.currency)}</CardContent>
            </Card>
          ))}
          {availableAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет активных касс для выдачи.</p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
