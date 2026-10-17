import { auth } from "@/auth";
import { PAYROLL_MANAGE_ROLES, hasAnyRole } from "@/lib/roles";
import { paySchemeLabels } from "@/lib/labels";
import {
  currentMonth,
  getPayrollCurrency,
  getPayrollSummary,
  isValidMonth,
} from "@/server/payroll/queries";

// Экспорт сводки по зарплате за месяц в CSV (§10: закрытие месяца).
// Разделитель «;» и BOM — чтобы русский Excel открывал корректно.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user || !hasAnyRole(session.user.roles, PAYROLL_MANAGE_ROLES)) {
    return new Response("Недостаточно прав", { status: 403 });
  }

  const param = new URL(request.url).searchParams.get("month") ?? undefined;
  if (param !== undefined && !isValidMonth(param)) return new Response("Некорректный расчётный месяц", { status: 400 });
  const month = param ?? currentMonth();

  const [summary, currency] = await Promise.all([
    getPayrollSummary(month),
    getPayrollCurrency(),
  ]);

  const fmt = (value: number | null) => value === null ? "Недоступно: нет подтверждённого BYN-эквивалента" : value.toFixed(2).replace(".", ",");
  const escape = (cell: string) => `"${cell.replaceAll('"', '""')}"`;
  const lines = [
    ["ФИО", "Схема оплаты", `Начислено (${currency})`, `Выплачено (${currency})`, `Аванс (${currency})`, `Долг к выплате (${currency})`],
    ...summary.rows.map((row) => [
      row.name,
      `${paySchemeLabels[row.payScheme] ?? row.payScheme}${row.payPercent ? ` ${row.payPercent}%` : ""}`,
      fmt(row.accrued),
      fmt(row.paid),
      fmt(row.advance),
      fmt(row.due),
    ]),
    ["ИТОГО", "", fmt(summary.totals.accrued), fmt(summary.totals.paid), fmt(summary.totals.advance), fmt(summary.totals.due)],
  ];
  // BOM первым символом — Excel без него ломает кириллицу
  const csv =
    "﻿" + lines.map((line) => line.map(escape).join(";")).join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="payroll-${month}.csv"`,
    },
  });
}
