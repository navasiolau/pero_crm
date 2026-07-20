"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DataTable,
  type DataColumn,
} from "@/components/ui/data-table";
import { MonthSwitcher, monthLabel } from "@/components/month-switcher";
import { formatAmount } from "@/lib/format";
import { entrySchemeLabels } from "@/lib/labels";
import type { PayrollEntryView, PayoutView } from "@/server/payroll/queries";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU");
}

// Расчётник «Моя зарплата» (§10): сверху — два главных числа без двусмысленности:
// «К выплате сейчас» (долг за прошлые месяцы) и «Приблизительная зарплата»
// текущего месяца; ниже — записи выбранного месяца с переключателем.
export function PayrollView({
  month,
  currency,
  accrued,
  paid,
  debt,
  estimate,
  entries,
  payouts,
}: {
  month: string;
  currency: string;
  accrued: number;
  paid: number;
  debt: number;
  estimate: number;
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
      id: "scheme",
      header: "Схема",
      sortable: true,
      sortValue: (row) => entrySchemeLabels[row.scheme] ?? row.scheme,
      cell: (row) => (
        <span className="text-muted-foreground">
          {entrySchemeLabels[row.scheme] ?? row.scheme}
        </span>
      ),
    },
    {
      id: "comment",
      header: "Основание",
      sortable: true,
      sortValue: (row) => row.comment ?? "",
      cell: (row) => row.comment ?? "—",
    },
    {
      id: "amount",
      header: "Сумма",
      sortable: true,
      sortValue: (row) => row.amount,
      className: "text-right font-medium",
      headerClassName: "text-right",
      cell: (row) => formatAmount(row.amount, currency),
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
      id: "comment",
      header: "Комментарий",
      sortable: true,
      sortValue: (row) => row.comment ?? "",
      cell: (row) => row.comment ?? "—",
    },
    {
      id: "createdBy",
      header: "Кто внёс",
      sortable: true,
      sortValue: (row) => row.createdByName ?? "",
      cell: (row) => (
        <span className="text-muted-foreground">{row.createdByName ?? "—"}</span>
      ),
    },
    {
      id: "amount",
      header: "Сумма",
      sortable: true,
      sortValue: (row) => row.amount,
      className: "text-right font-medium",
      headerClassName: "text-right",
      cell: (row) => formatAmount(row.amount, currency),
    },
  ];

  const currentMonthLabel = monthLabel(new Date().toISOString().slice(0, 7));
  const stats = [
    {
      title: "К выплате сейчас",
      value: debt,
      note: "долг организации за прошлые месяцы",
    },
    {
      title: "Приблизительная зарплата",
      value: estimate,
      note: `${currentMonthLabel} — окончательная сумма после закрытия месяца`,
    },
    {
      title: `Начислено за ${monthLabel(month).toLowerCase()}`,
      value: accrued,
      note: "по записям ниже",
    },
    {
      title: `Выплачено за ${monthLabel(month).toLowerCase()}`,
      value: paid,
      note: "по записям ниже",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Моя зарплата</h1>
          <p className="text-sm text-muted-foreground">
            Деньги платятся за прошлый месяц; текущий месяц — приблизительная
            оценка
          </p>
        </div>
        <MonthSwitcher month={month} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">
                {formatAmount(stat.value, currency)}
              </div>
              <p className="text-xs text-muted-foreground">{stat.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Начисления</h2>
        <DataTable
          columns={entryColumns}
          rows={entries}
          searchPlaceholder="Поиск по основанию…"
          emptyText="За этот месяц начислений нет"
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Выплаты</h2>
        <DataTable
          columns={payoutColumns}
          rows={payouts}
          searchPlaceholder="Поиск по комментарию…"
          emptyText="За этот месяц выплат нет"
        />
      </div>
    </div>
  );
}
