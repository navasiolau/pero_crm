"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Download, HandCoins, Plus, Trash2, Calculator } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DataTable,
  type DataColumn,
} from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Label } from "@/components/ui/label";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { MonthSwitcher, monthLabel } from "@/components/month-switcher";
import { formatAmount, formatMoneyTotal } from "@/lib/format";
import { paySchemeLabels, payoutKindLabels } from "@/lib/labels";
import type { CashAccountView } from "@/server/finance/queries";
import { AdvancePayoutDialog } from "@/app/(app)/advances/advance-payout-dialog";
import { CashPayoutForm } from "@/app/(app)/advances/cash-payout-form";
import { didSettleAnything, settlementConfirmationDisabled, settlementPreviewDisclosure } from "./settlement-preview";
import {
  accrueTurnover,
  deletePayout,
  settleAll,
} from "@/server/payroll/actions";
import type {
  EmployeeDue,
  PayrollSummaryRow,
  PayoutView,
} from "@/server/payroll/queries";

// Округление до копеек (на клиенте — локально, серверный queries не импортируем)
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU");
}

type TurnoverAccrual = {
  userId: string;
  name: string;
  percent: number;
  accruedAmount: number | null;
};

// «Финансы → Зарплата» (§10): сводка по сотрудникам за месяц,
// начисление «% от оборота», выплаты, экспорт CSV.
export function FinancePayrollView({
  month,
  currency,
  rows,
  totals,
  payouts,
  turnover,
  turnoverAccruals,
  users,
  orgBalance,
  dues,
  estimates,
  cashAccounts,
  advanceUsers,
}: {
  month: string;
  currency: string;
  rows: PayrollSummaryRow[];
  totals: { accrued: number | null; paid: number | null; advance: number | null; due: number | null };
  payouts: PayoutView[];
  turnover: { total: number; paymentsCount: number; currency: string };
  turnoverAccruals: TurnoverAccrual[];
  users: { id: string; name: string; position: string | null }[];
  orgBalance: number | null;
  dues: EmployeeDue[];
  estimates: Record<string, number | null>;
  cashAccounts: CashAccountView[];
  advanceUsers: { id: string; name: string; position: string | null }[];
}) {
  const [pending, startTransition] = useTransition();
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [salaryPayoutUncertain, setSalaryPayoutUncertain] = useState(false);
  const [deleting, setDeleting] = useState<PayoutView | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleCashAccountId, setSettleCashAccountId] = useState("");
  const activeCashAccounts = cashAccounts.filter((account) => account.active);

  // Превью «Рассчитать всех»: долги, покрываемые балансом по порядку
  const settlePreview = (() => {
    if (orgBalance === null || dues.some((row) => row.due === null)) return [];
    let remaining = orgBalance;
    return dues
      .filter((row): row is EmployeeDue & { due: number } => row.due !== null && row.due > 0)
      .map((row) => {
        const pay = round2(Math.max(0, Math.min(row.due, remaining)));
        remaining = round2(remaining - pay);
        return { ...row, pay };
      });
  })();
  const settlementUnavailable = orgBalance === null || dues.some((row) => row.due === null);
  const settleTotal = round2(settlePreview.reduce((sum, row) => sum + row.pay, 0));
  const settleCashAccount = activeCashAccounts.find((account) => account.id === settleCashAccountId);
  const hasFundedActiveCash = activeCashAccounts.some((account) => account.balance > 0);

  const summaryColumns: DataColumn<PayrollSummaryRow>[] = [
    {
      id: "name",
      header: "Сотрудник",
      sortable: true,
      sortValue: (row) => row.name,
      cell: (row) => row.name,
    },
    {
      id: "scheme",
      header: "Схема",
      sortable: true,
      sortValue: (row) => paySchemeLabels[row.payScheme] ?? row.payScheme,
      cell: (row) => (
        <span className="text-muted-foreground">
          {paySchemeLabels[row.payScheme] ?? row.payScheme}
          {row.payPercent ? ` ${row.payPercent}%` : ""}
        </span>
      ),
    },
    {
      id: "accrued",
      header: "Начислено",
      sortable: true,
      sortValue: (row) => row.accrued ?? "",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => formatMoneyTotal(row.accrued, currency),
    },
    {
      id: "paid",
      header: "Выплачено",
      sortable: true,
      sortValue: (row) => row.paid ?? "",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => formatMoneyTotal(row.paid, currency),
    },
    {
      id: "advance",
      header: "Аванс",
      sortable: true,
      sortValue: (row) => row.advance ?? "",
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) =>
        row.advance === null ? formatMoneyTotal(null) : row.advance > 0 ? (
          formatMoneyTotal(row.advance, currency)
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "due",
      header: "Долг к выплате",
      sortable: true,
      sortValue: (row) => row.due ?? "",
      className: "text-right font-medium",
      headerClassName: "text-right",
      cell: (row) => formatMoneyTotal(row.due, currency),
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
      id: "user",
      header: "Сотрудник",
      sortable: true,
      sortValue: (row) => row.userName ?? "",
      cell: (row) => row.userName ?? "—",
    },
    {
      id: "kind",
      header: "Тип",
      sortable: true,
      sortValue: (row) => row.kind,
      cell: (row) =>
        row.kind === "ADVANCE" ? (
          <Badge variant="secondary">{payoutKindLabels.ADVANCE}</Badge>
        ) : (
          <Badge variant="outline">{payoutKindLabels.SALARY}</Badge>
        ),
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
      id: "physical",
      header: "Выдано из кассы",
      sortable: true,
      sortValue: (row) => row.cashAmount ?? "",
      cell: (row) => row.cashAmount !== null && row.cashAmount !== undefined && row.cashCurrency
        ? <span className="flex flex-col"><span>{formatAmount(row.cashAmount, row.cashCurrency)}</span><span className="text-xs text-muted-foreground">{row.cashAccountName ?? "Касса"}</span></span>
        : <Badge variant="outline">Историческая (legacy)</Badge>,
    },
    {
      id: "amount",
      header: "Сумма",
      sortable: true,
      sortValue: (row) => row.amount,
      className: "text-right font-medium",
      headerClassName: "text-right",
      cell: (row) => row.payrollCurrency ? formatAmount(row.amount, row.payrollCurrency) : `${formatAmount(row.amount, "")} · валюта неизвестна`,
    },
    {
      id: "actions",
      header: "",
      className: "w-10",
      cell: (row) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Удалить выплату"
          onClick={(event) => {
            event.stopPropagation();
            setDeleting(row);
          }}
        >
          <Trash2 className="size-4 text-muted-foreground" />
        </Button>
      ),
    },
  ];

  // Начисление — только за прошлый месяц (правило владельца): в текущем
  // месяце показываем приблизительную зарплату, кнопки начисления нет.
  const isCurrentMonth = month >= new Date().toISOString().slice(0, 7);
  // Кому требуется (до)начисление: расчёт от текущего оборота больше начисленного
  const pendingAccruals = turnoverAccruals.filter((accrual) => {
    const expected = round2((turnover.total * accrual.percent) / 100);
    return expected > round2(accrual.accruedAmount ?? 0);
  });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Зарплата</h1>
          <p className="text-sm text-muted-foreground">
            Закрытие месяца: сводка по сотрудникам, выплаты, экспорт
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MonthSwitcher month={month} />
          <a
            className={buttonVariants({ variant: "outline" })}
            href={`/finance/payroll/export?month=${month}`}
            download
          >
            <Download className="size-4" />
            Экспорт CSV
          </a>
        </div>
      </div>

      {settlementUnavailable ? <p className="text-sm text-destructive">Расчёт всех недоступен: исторические суммы не имеют подтверждённого BYN-эквивалента.</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Начислено за {monthLabel(month).toLowerCase()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatMoneyTotal(totals.accrued, currency)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Выплачено за {monthLabel(month).toLowerCase()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatMoneyTotal(totals.paid, currency)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              К выплате сейчас
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatMoneyTotal(totals.due, currency)}
            </div>
            <p className="text-xs text-muted-foreground">
              долг за прошлые месяцы
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Баланс организации
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatMoneyTotal(orgBalance, currency)}
            </div>
            <p className="text-xs text-muted-foreground">
              приходы − выплаты, за всё время
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Сводка по сотрудникам</h2>
        <DataTable
          columns={summaryColumns}
          rows={rows.map((row) => ({ ...row, id: row.userId }))}
          searchPlaceholder="Поиск по сотруднику…"
          emptyText="За этот месяц движений нет"
        />
      </div>

      {turnoverAccruals.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {isCurrentMonth
                ? "Приблизительная зарплата «% от оборота»"
                : "Начисление «% от оборота»"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Оборот за {monthLabel(month).toLowerCase()}:{" "}
              <span className="font-medium text-foreground">
                {formatAmount(turnover.total, turnover.currency)}
              </span>{" "}
              ({turnover.paymentsCount}{" "}
              {turnover.paymentsCount === 1 ? "приход" : "приходов(а)"}) —
              сумма приходов по проектам за месяц.
            </p>
            {isCurrentMonth ? (
              <>
                <ul className="flex flex-col gap-1 text-sm">
                  {turnoverAccruals.map((accrual) => {
                    const expected = round2(
                      (turnover.total * accrual.percent) / 100,
                    );
                    return (
                      <li key={accrual.userId} className="flex flex-wrap gap-x-2">
                        <span>{accrual.name}</span>
                        <span className="text-muted-foreground">
                          {accrual.percent}% → ≈{formatAmount(expected, currency)}
                        </span>
                        <span className="text-muted-foreground">
                          приблизительно
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Это приблизительная зарплата: оборот месяца ещё меняется.
                  Начислить можно будет после окончания месяца.
                </p>
              </>
            ) : (
              <>
                <ul className="flex flex-col gap-1 text-sm">
                  {turnoverAccruals.map((accrual) => {
                    const expected = round2(
                      (turnover.total * accrual.percent) / 100,
                    );
                    const accrued = round2(accrual.accruedAmount ?? 0);
                    const diff = round2(expected - accrued);
                    return (
                      <li key={accrual.userId} className="flex flex-wrap gap-x-2">
                        <span>{accrual.name}</span>
                        <span className="text-muted-foreground">
                          {accrual.percent}% → {formatAmount(expected, currency)}
                        </span>
                        {accrued === 0 ? (
                          <span className="text-amber-600 dark:text-amber-400">
                            ожидает начисления
                          </span>
                        ) : diff > 0 ? (
                          <span className="text-amber-600 dark:text-amber-400">
                            начислено {formatAmount(accrued, currency)} · доначислить{" "}
                            {formatAmount(diff, currency)}
                          </span>
                        ) : diff === 0 ? (
                          <span className="text-green-600 dark:text-green-400">
                            начислено актуально
                          </span>
                        ) : (
                          <span className="text-destructive">
                            начислено {formatAmount(accrued, currency)} · больше
                            расчётного на {formatAmount(-diff, currency)} (оборот
                            снизился — разберите вручную)
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {pendingAccruals.length > 0 ? (
                  <div>
                    <Button
                      variant="outline"
                      disabled={pending || turnover.total <= 0}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await accrueTurnover(month);
                          if (result.ok) {
                            toast.success(
                              result.accruedCount
                                ? `Начислено/доначислено: ${result.accruedCount} сотр.`
                                : "Все начисления актуальны",
                            );
                          } else {
                            toast.error(result.error ?? "Ошибка начисления");
                          }
                        })
                      }
                    >
                      {pending ? "Начисление…" : "Начислить / доначислить % от оборота"}
                    </Button>
                    {turnover.total <= 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Оборот за месяц нулевой — начислять нечего
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Выплаты</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="min-h-12 h-auto whitespace-normal"
              disabled={settlementUnavailable || settlePreview.every((row) => row.pay <= 0) || !hasFundedActiveCash}
              onClick={() => setSettleOpen(true)}
            >
              <Calculator className="size-4" />
              Рассчитать всех
            </Button>
            {!hasFundedActiveCash ? <span className="text-xs text-destructive">Нет активной кассы с доступным остатком для расчёта.</span> : null}
            <Button className="min-h-12 h-auto whitespace-normal" onClick={() => setPayoutOpen(true)}>
              <Plus className="size-4" />
              Добавить выплату
            </Button>
            <Button className="min-h-12 h-auto whitespace-normal" variant="outline" onClick={() => setAdvanceOpen(true)}>
              <HandCoins className="size-4" />
              Выдать аванс
            </Button>
          </div>
        </div>
        <DataTable
          columns={payoutColumns}
          rows={payouts}
          searchPlaceholder="Поиск по сотруднику…"
          emptyText="За этот месяц выплат нет"
        />
      </div>

      <Dialog open={settleOpen} onOpenChange={setSettleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Рассчитать всех</DialogTitle>
            <DialogDescription>
              Выберите кассу. Сервер рассчитает и спишет выплаты с комментарием «Выплата зарплаты от {new Date().toLocaleDateString("ru-RU")}».
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label>Касса для выплаты *</Label>
            <SearchableSelect
              options={activeCashAccounts.map((account) => ({
                value: account.id,
                label: `${account.name} · ${account.currency}`,
                hint: `Доступно ${formatAmount(account.balance, account.currency)}`,
              }))}
              value={settleCashAccountId}
              onChange={setSettleCashAccountId}
              placeholder="Выберите кассу…"
              searchPlaceholder="Поиск кассы…"
              className="min-h-12 h-auto whitespace-normal text-left"
            />
          </div>
          {settleCashAccount ? <p className="text-sm text-muted-foreground">Остаток выбранной кассы: {formatAmount(settleCashAccount.balance, settleCashAccount.currency)}. {settlementPreviewDisclosure(currency, settleCashAccount.currency)}</p> : <p className="text-sm text-muted-foreground">В таблице показана только верхняя граница по долгам и балансу организации; выберите кассу, чтобы увидеть её остаток.</p>}
          {settleCashAccount && settleCashAccount.balance <= 0 ? <p className="text-sm text-destructive" role="alert">В выбранной кассе нет средств. Выберите кассу с положительным остатком.</p> : null}
          <ul className="flex flex-col gap-1 text-sm">
            {settlePreview.map((row) => (
              <li key={row.userId} className="flex flex-wrap justify-between gap-2">
                <span>{row.name}</span>
                {row.pay > 0 ? (
                  <span className="font-medium">
                    {formatAmount(row.pay, currency)}
                    {row.pay < row.due ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        {" "}
                        из {formatMoneyTotal(row.due, currency)} — ограничено балансом организации
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-destructive">баланс исчерпан</span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-sm">
            Верхняя граница по долгу и балансу организации:{" "}
            <span className="font-semibold">
              {formatAmount(settleTotal, currency)}
            </span>{" "}
            · баланс организации {formatMoneyTotal(orgBalance, currency)}
          </p>
          <DialogFooter>
            <Button className="min-h-12 h-auto whitespace-normal" variant="outline" onClick={() => setSettleOpen(false)}>
              Отмена
            </Button>
            <Button
              className="min-h-12 h-auto whitespace-normal"
              disabled={settlementUnavailable || settlementConfirmationDisabled(settleCashAccount?.balance ?? 0, settleTotal, pending) || !settleCashAccountId}
              onClick={() =>
                startTransition(async () => {
                  const result = await settleAll(month, settleCashAccountId);
                  if (result.ok) {
                    if (didSettleAnything(result)) {
                      toast.success(`Выплачено ${formatAmount(result.totalPaid ?? 0, currency)} (${result.paidCount} сотр.)`);
                      setSettleOpen(false);
                    } else {
                      toast.warning("Выплаты не проведены: проверьте остаток выбранной кассы и доступный долг.");
                    }
                    if (result.shortPaid && result.shortPaid.length > 0) {
                      toast.warning(
                        `Баланса не хватило: ${result.shortPaid.join(", ")}`,
                      );
                    }
                  } else {
                    toast.error(result.error ?? "Ошибка расчёта");
                  }
                })
              }
            >
              {pending ? "Расчёт…" : "Подтвердить выплаты"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={payoutOpen} onOpenChange={(next) => {
        if (!next && salaryPayoutUncertain) return;
        setPayoutOpen(next);
      }}>
        {payoutOpen ? (
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Выплата зарплаты</DialogTitle>
              <DialogDescription>Расчётный месяц: {monthLabel(month).toLowerCase()}. Сумма указывается в валюте кассы.</DialogDescription>
            </DialogHeader>
            <CashPayoutForm mode="SALARY" users={users} accounts={activeCashAccounts} month={month} dues={dues} orgBalance={orgBalance} salaryCurrency={currency} onUncertainChange={setSalaryPayoutUncertain} onClose={() => setPayoutOpen(false)} />
          </DialogContent>
        ) : null}
      </Dialog>

      <AdvancePayoutDialog open={advanceOpen} onOpenChange={setAdvanceOpen} users={advanceUsers} accounts={activeCashAccounts} estimates={estimates} />
      <ConfirmDeleteDialog
        entityLabel="выплату"
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        warning={
          deleting
            ? `${deleting.userName ?? ""}, ${deleting.payrollCurrency ? formatAmount(deleting.amount, deleting.payrollCurrency) : `${formatAmount(deleting.amount, "")} · валюта неизвестна`} — ${
                deleting.kind === "ADVANCE"
                  ? "аванс отменится, сумма вернётся в баланс."
                  : "сумма вернётся в «к выплате»."
              }`
            : undefined
        }
        onConfirm={async () => {
          if (!deleting) return false;
          const result = await deletePayout(deleting.id);
          if (result.ok) {
            toast.success("Выплата удалена");
            return true;
          }
          toast.error(result.error ?? "Ошибка удаления");
          return false;
        }}
      />
    </div>
  );
}
