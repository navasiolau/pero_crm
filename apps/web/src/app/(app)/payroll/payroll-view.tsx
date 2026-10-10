"use client";

import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { MonthSwitcher, monthLabel } from "@/components/month-switcher";
import { formatAmount, formatDate } from "@/lib/format";
import { payrollEntryTypeLabel, payoutKindLabels } from "@/lib/labels";
import type { PayrollEntryView, PayoutView } from "@/server/payroll/queries";

function moneyLabel(amount: number | null, currency: string): string {
  return amount === null ? "Сумма неизвестна" : formatAmount(amount, currency);
}

function RowDetails({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <details className="mt-2 text-sm font-normal">
      <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        Детали
      </summary>
      <dl className="mt-2 space-y-2 rounded-lg bg-muted/40 p-3 text-left whitespace-normal">
        {items.map((item) => (
          <div key={item.label}>
            <dt className="text-xs text-muted-foreground">{item.label}</dt>
            <dd className="break-words">{item.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function EntryDetails({ row }: { row: PayrollEntryView }) {
  return (
    <RowDetails items={[
      { label: "Тип начисления", value: payrollEntryTypeLabel(row.scheme) || row.scheme },
      { label: "Основание", value: row.comment || "Не указано" },
      { label: "Исходная сумма", value: formatAmount(row.amount, row.currency) },
      { label: "Сохранённый эквивалент BYN", value: moneyLabel(row.bynAmount, "BYN") },
    ]} />
  );
}

function PayoutDetails({ row }: { row: PayoutView }) {
  const hasCash = row.cashAmount !== null && row.cashAmount !== undefined && !!row.cashCurrency;
  return (
    <RowDetails items={[
      { label: "Комментарий", value: row.comment || "Не указан" },
      { label: "Кто внёс", value: row.createdByName || "Не указан" },
      { label: "Касса", value: row.cashAccountName || "Историческая выплата: касса не указана" },
      {
        label: "Выдано из кассы",
        value: hasCash ? formatAmount(row.cashAmount, row.cashCurrency!) : "Данные не сохранены",
      },
      {
        label: "Исходная сумма выплаты",
        value: row.payrollCurrency
          ? formatAmount(row.amount, row.payrollCurrency)
          : formatAmount(row.amount, "") + " · валюта неизвестна",
      },
      { label: "Сохранённый эквивалент BYN", value: moneyLabel(row.bynAmount, "BYN") },
    ]} />
  );
}

function PayoutKind({ kind }: { kind: string }) {
  return (
    <Badge variant={kind === "ADVANCE" ? "secondary" : "outline"}>
      {payoutKindLabels[kind] ?? kind}
    </Badge>
  );
}

// Текущие суммы не зависят от месяца, выбранного в истории.
// Суммы строк — уже сохранённые BYN-эквиваленты, исходные валюты — в деталях.
export function PayrollView({
  month,
  currentPeriod,
  currency,
  accrued,
  paid,
  debt,
  estimate,
  entries,
  payouts,
}: {
  month: string;
  currentPeriod: string;
  currency: string;
  accrued: number | null;
  paid: number | null;
  debt: number | null;
  estimate: number | null;
  entries: PayrollEntryView[];
  payouts: PayoutView[];
}) {
  const entryColumns: DataColumn<PayrollEntryView>[] = [
    {
      id: "date",
      header: "Дата",
      sortable: true,
      sortValue: (row) => row.createdAt,
      cell: (row) => formatDate(row.createdAt),
    },
    {
      id: "basis",
      header: "Основание",
      sortable: true,
      sortValue: (row) => row.comment || payrollEntryTypeLabel(row.scheme),
      searchValue: (row) => [row.comment, payrollEntryTypeLabel(row.scheme), row.currency].join(" "),
      className: "whitespace-normal",
      cell: (row) => (
        <div>
          <span>{row.comment || payrollEntryTypeLabel(row.scheme) || "Начисление"}</span>
          <EntryDetails row={row} />
        </div>
      ),
    },
    {
      id: "amount",
      header: "Сумма, BYN",
      sortable: true,
      sortValue: (row) => row.bynAmount ?? "",
      className: "text-right font-medium whitespace-normal",
      headerClassName: "text-right",
      cell: (row) => moneyLabel(row.bynAmount, currency),
    },
  ];

  const payoutColumns: DataColumn<PayoutView>[] = [
    {
      id: "date",
      header: "Дата",
      sortable: true,
      sortValue: (row) => row.createdAt,
      cell: (row) => formatDate(row.createdAt),
    },
    {
      id: "kind",
      header: "Выплата",
      sortable: true,
      sortValue: (row) => payoutKindLabels[row.kind] ?? row.kind,
      searchValue: (row) => [
        payoutKindLabels[row.kind], row.comment, row.createdByName,
        row.cashAccountName, row.cashCurrency, row.payrollCurrency,
      ].join(" "),
      className: "whitespace-normal",
      cell: (row) => (
        <div>
          <PayoutKind kind={row.kind} />
          <PayoutDetails row={row} />
        </div>
      ),
    },
    {
      id: "amount",
      header: "Сумма, BYN",
      sortable: true,
      sortValue: (row) => row.bynAmount ?? "",
      className: "text-right font-medium whitespace-normal",
      headerClassName: "text-right",
      cell: (row) => moneyLabel(row.bynAmount, currency),
    },
  ];

  const hasUnknownTotals = [debt, estimate, accrued, paid].some((value) => value === null);

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Моя зарплата</h1>
        <p className="text-sm text-muted-foreground">
          Текущие суммы и история ваших начислений и выплат.
        </p>
      </div>

      <section aria-labelledby="payroll-now" className="flex flex-col gap-3">
        <h2 id="payroll-now" className="text-lg font-semibold">Сейчас</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                К выплате сейчас
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold">
                {moneyLabel(debt === null ? null : Math.max(debt, 0), currency)}
              </div>
              <p className="text-xs text-muted-foreground">
                Начислено за прошлые месяцы за вычетом всех полученных выплат.
              </p>
              {debt !== null && debt < 0 && (
                <p className="text-sm">
                  Выплачено вперёд: {formatAmount(-debt, currency)}.
                  Эта сумма учтётся в следующих выплатах.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                За {monthLabel(currentPeriod).toLowerCase()}, приблизительно
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-2xl font-semibold">
                {estimate !== null && "≈ "}{moneyLabel(estimate, currency)}
              </div>
              <p className="text-xs text-muted-foreground">
                Месяц ещё идёт. Окончательная сумма будет известна после его закрытия.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="payroll-history" className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="payroll-history" className="text-lg font-semibold">История за месяц</h2>
            <p className="text-xs text-muted-foreground">
              Выбор месяца меняет только историю ниже.
            </p>
          </div>
          <MonthSwitcher month={month} />
        </div>

        <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4">
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <p>Начислено: <strong>{moneyLabel(accrued, currency)}</strong></p>
            <p>Выплачено: <strong>{moneyLabel(paid, currency)}</strong></p>
          </div>
          <p className="text-xs text-muted-foreground">
            {monthLabel(month)} · Итоги в BYN
          </p>
          {month === currentPeriod && (
            <p className="text-sm text-muted-foreground">
              Месяц ещё идёт. Начисления этого месяца пока не входят в сумму «К выплате сейчас».
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="font-semibold">Начисления</h3>
          <DataTable
            columns={entryColumns}
            rows={entries}
            searchPlaceholder="Поиск по основанию…"
            emptyText="За этот месяц начислений нет"
            renderMobileCard={(row) => (
              <div className="min-w-0 space-y-2">
                <p className="text-xs text-muted-foreground">{formatDate(row.createdAt)}</p>
                <p className="break-words">{row.comment || payrollEntryTypeLabel(row.scheme) || "Начисление"}</p>
                <p className="font-semibold">{moneyLabel(row.bynAmount, currency)}</p>
                <EntryDetails row={row} />
              </div>
            )}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="font-semibold">Полученные выплаты</h3>
          <DataTable
            columns={payoutColumns}
            rows={payouts}
            searchPlaceholder="Поиск по выплатам…"
            emptyText="За этот месяц выплат нет"
            renderMobileCard={(row) => (
              <div className="min-w-0 space-y-2">
                <p className="text-xs text-muted-foreground">{formatDate(row.createdAt)}</p>
                <PayoutKind kind={row.kind} />
                <p className="font-semibold">{moneyLabel(row.bynAmount, currency)}</p>
                <PayoutDetails row={row} />
              </div>
            )}
          />
        </div>
      </section>

      {hasUnknownTotals && (
        <p className="text-sm text-muted-foreground">
          Точную сумму нельзя определить: у части исторических записей не сохранён эквивалент BYN.
          Исходные суммы и валюты доступны в деталях.
        </p>
      )}
    </div>
  );
}
