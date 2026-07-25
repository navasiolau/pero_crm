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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { MonthSwitcher, monthLabel } from "@/components/month-switcher";
import { formatAmount } from "@/lib/format";
import { paySchemeLabels, payoutKindLabels } from "@/lib/labels";
import {
  addPayout,
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
}: {
  month: string;
  currency: string;
  rows: PayrollSummaryRow[];
  totals: { accrued: number; paid: number; advance: number; due: number };
  payouts: PayoutView[];
  turnover: { total: number; paymentsCount: number; currency: string };
  turnoverAccruals: TurnoverAccrual[];
  users: { id: string; name: string; position: string | null }[];
  orgBalance: number;
  dues: EmployeeDue[];
  estimates: Record<string, number>;
}) {
  const [pending, startTransition] = useTransition();
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutUserId, setPayoutUserId] = useState("");
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutComment, setPayoutComment] = useState("");
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceUserId, setAdvanceUserId] = useState("");
  const [advanceAmount, setAdvanceAmount] = useState("");
  const [advanceComment, setAdvanceComment] = useState("");
  const [deleting, setDeleting] = useState<PayoutView | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);

  // Потолки для диалога выплаты: долг сотруднику и баланс организации
  // (нулевого долга в dues нет — трактуем как 0, чтобы показать подсказку)
  const selectedDue = payoutUserId
    ? (dues.find((row) => row.userId === payoutUserId)?.due ?? 0)
    : null;
  const payoutMax =
    selectedDue === null ? null : round2(Math.min(selectedDue, orgBalance));

  // Превью «Рассчитать всех»: долги, покрываемые балансом по порядку
  const settlePreview = (() => {
    let remaining = orgBalance;
    return dues
      .filter((row) => row.due > 0)
      .map((row) => {
        const pay = round2(Math.max(0, Math.min(row.due, remaining)));
        remaining = round2(remaining - pay);
        return { ...row, pay };
      });
  })();
  const settleTotal = round2(settlePreview.reduce((sum, row) => sum + row.pay, 0));

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
      sortValue: (row) => row.accrued,
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => formatAmount(row.accrued, currency),
    },
    {
      id: "paid",
      header: "Выплачено",
      sortable: true,
      sortValue: (row) => row.paid,
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => formatAmount(row.paid, currency),
    },
    {
      id: "advance",
      header: "Аванс",
      sortable: true,
      sortValue: (row) => row.advance,
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) =>
        row.advance > 0 ? (
          formatAmount(row.advance, currency)
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "due",
      header: "Долг к выплате",
      sortable: true,
      sortValue: (row) => row.due,
      className: "text-right font-medium",
      headerClassName: "text-right",
      cell: (row) => formatAmount(row.due, currency),
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
      id: "amount",
      header: "Сумма",
      sortable: true,
      sortValue: (row) => row.amount,
      className: "text-right font-medium",
      headerClassName: "text-right",
      cell: (row) => formatAmount(row.amount, currency),
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
  const payoutSum = payoutAmount.trim() === "" ? NaN : Number(payoutAmount);

  // Аванс: потолок — только баланс организации; приблизительная зарплата
  // текущего месяца — мягкая подсказка (предупреждение, не запрет)
  const currentMonthValue = new Date().toISOString().slice(0, 7);
  const advanceEstimate = advanceUserId ? (estimates[advanceUserId] ?? 0) : null;
  const advanceSum = advanceAmount.trim() === "" ? NaN : Number(advanceAmount);

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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Начислено за {monthLabel(month).toLowerCase()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatAmount(totals.accrued, currency)}
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
              {formatAmount(totals.paid, currency)}
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
              {formatAmount(totals.due, currency)}
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
              {formatAmount(orgBalance, currency)}
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
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={settlePreview.every((row) => row.pay <= 0)}
              onClick={() => setSettleOpen(true)}
            >
              <Calculator className="size-4" />
              Рассчитать всех
            </Button>
            <Button onClick={() => setPayoutOpen(true)}>
              <Plus className="size-4" />
              Добавить выплату
            </Button>
            <Button variant="outline" onClick={() => setAdvanceOpen(true)}>
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
              Будут созданы выплаты по задолженности перед сотрудниками
              с комментарием «Выплата зарплаты от {new Date().toLocaleDateString("ru-RU")}».
            </DialogDescription>
          </DialogHeader>
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
                        из {formatAmount(row.due, currency)} — не хватит баланса
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
            Итого:{" "}
            <span className="font-semibold">
              {formatAmount(settleTotal, currency)}
            </span>{" "}
            · баланс организации {formatAmount(orgBalance, currency)}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettleOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={pending || settleTotal <= 0}
              onClick={() =>
                startTransition(async () => {
                  const result = await settleAll(month);
                  if (result.ok) {
                    toast.success(
                      `Выплачено ${formatAmount(result.totalPaid ?? 0, currency)} (${result.paidCount} сотр.)`,
                    );
                    if (result.shortPaid && result.shortPaid.length > 0) {
                      toast.warning(
                        `Баланса не хватило: ${result.shortPaid.join(", ")}`,
                      );
                    }
                    setSettleOpen(false);
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

      <Dialog
        open={payoutOpen}
        onOpenChange={(next) => {
          if (!next) {
            setPayoutUserId("");
            setPayoutAmount("");
            setPayoutComment("");
          }
          setPayoutOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Выплата зарплаты</DialogTitle>
            <DialogDescription>
              Расчётный месяц: {monthLabel(month).toLowerCase()}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Сотрудник *</Label>
              <SearchableSelect
                options={users.map((user) => ({
                  value: user.id,
                  label: user.name,
                  hint: user.position ?? undefined,
                }))}
                value={payoutUserId}
                onChange={(value) => {
                  setPayoutUserId(value);
                  setPayoutAmount("");
                }}
                placeholder="Выберите сотрудника…"
                searchPlaceholder="Поиск сотрудника…"
              />
              {payoutUserId ? (
                <p className="text-xs text-muted-foreground">
                  К выплате сотруднику:{" "}
                  {formatAmount(selectedDue ?? 0, currency)} · баланс организации:{" "}
                  {formatAmount(orgBalance, currency)}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="payout-amount">Сумма, {currency} *</Label>
              <div className="flex gap-2">
                <Input
                  id="payout-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={payoutAmount}
                  onChange={(event) => setPayoutAmount(event.target.value)}
                  placeholder="0.00"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!payoutMax || payoutMax <= 0}
                  onClick={() => setPayoutAmount(String(payoutMax))}
                >
                  Вся сумма
                </Button>
              </div>
              {payoutUserId && payoutMax !== null && payoutMax <= 0 ? (
                <p className="text-xs text-destructive">
                  Выплачивать нечего: нет долга за прошлые месяцы или пуст баланс
                </p>
              ) : null}
              {Number.isFinite(payoutSum) &&
              payoutMax !== null &&
              payoutSum > payoutMax ? (
                <p className="text-xs text-destructive">
                  Сумма превышает доступную ({formatAmount(payoutMax, currency)})
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="payout-comment">Комментарий</Label>
              <Input
                id="payout-comment"
                value={payoutComment}
                onChange={(event) => setPayoutComment(event.target.value)}
                placeholder="Аванс, окончательный расчёт…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayoutOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={
                pending ||
                !payoutUserId ||
                !Number.isFinite(payoutSum) ||
                payoutSum <= 0 ||
                payoutMax === null ||
                payoutSum > payoutMax
              }
              onClick={() =>
                startTransition(async () => {
                  const result = await addPayout({
                    userId: payoutUserId,
                    amount: payoutSum,
                    month,
                    comment: payoutComment.trim() || undefined,
                  });
                  if (result.ok) {
                    toast.success("Выплата внесена");
                    setPayoutOpen(false);
                    setPayoutUserId("");
                    setPayoutAmount("");
                    setPayoutComment("");
                  } else {
                    toast.error(result.error ?? "Ошибка");
                  }
                })
              }
            >
              {pending ? "Сохранение…" : "Внести выплату"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={advanceOpen}
        onOpenChange={(next) => {
          if (!next) {
            setAdvanceUserId("");
            setAdvanceAmount("");
            setAdvanceComment("");
          }
          setAdvanceOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Аванс</DialogTitle>
            <DialogDescription>
              Выплата под текущий месяц ({monthLabel(currentMonthValue).toLowerCase()})
              — вычтется из зарплаты при закрытии месяца. Потолок — баланс
              организации.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Сотрудник *</Label>
              <SearchableSelect
                options={users.map((user) => ({
                  value: user.id,
                  label: user.name,
                  hint: user.position ?? undefined,
                }))}
                value={advanceUserId}
                onChange={(value) => {
                  setAdvanceUserId(value);
                  setAdvanceAmount("");
                }}
                placeholder="Выберите сотрудника…"
                searchPlaceholder="Поиск сотрудника…"
              />
              {advanceUserId ? (
                <p className="text-xs text-muted-foreground">
                  Приблизительная зарплата за {monthLabel(currentMonthValue).toLowerCase()}:{" "}
                  ≈{formatAmount(advanceEstimate ?? 0, currency)} · баланс
                  организации: {formatAmount(orgBalance, currency)}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="advance-amount">Сумма, {currency} *</Label>
              <div className="flex gap-2">
                <Input
                  id="advance-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={advanceAmount}
                  onChange={(event) => setAdvanceAmount(event.target.value)}
                  placeholder="0.00"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={orgBalance <= 0}
                  onClick={() => setAdvanceAmount(String(round2(orgBalance)))}
                >
                  Вся сумма
                </Button>
              </div>
              {Number.isFinite(advanceSum) && advanceSum > orgBalance ? (
                <p className="text-xs text-destructive">
                  Сумма превышает баланс организации ({formatAmount(orgBalance, currency)})
                </p>
              ) : null}
              {Number.isFinite(advanceSum) &&
              advanceSum > 0 &&
              advanceSum <= orgBalance &&
              advanceSum > (advanceEstimate ?? 0) ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Больше приблизительной зарплаты за текущий месяц
                  (≈{formatAmount(advanceEstimate ?? 0, currency)}) — месяц ещё не
                  закрыт, оценка может вырасти
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="advance-comment">Комментарий</Label>
              <Input
                id="advance-comment"
                value={advanceComment}
                onChange={(event) => setAdvanceComment(event.target.value)}
                placeholder="Аванс"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdvanceOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={
                pending ||
                !advanceUserId ||
                !Number.isFinite(advanceSum) ||
                advanceSum <= 0 ||
                advanceSum > orgBalance
              }
              onClick={() =>
                startTransition(async () => {
                  const result = await addPayout({
                    userId: advanceUserId,
                    amount: advanceSum,
                    month: currentMonthValue,
                    kind: "ADVANCE",
                    comment: advanceComment.trim() || undefined,
                  });
                  if (result.ok) {
                    toast.success("Аванс выдан");
                    setAdvanceOpen(false);
                    setAdvanceUserId("");
                    setAdvanceAmount("");
                    setAdvanceComment("");
                  } else {
                    toast.error(result.error ?? "Ошибка");
                  }
                })
              }
            >
              {pending ? "Сохранение…" : "Выдать аванс"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        entityLabel="выплату"
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        warning={
          deleting
            ? `${deleting.userName ?? ""}, ${formatAmount(deleting.amount, currency)} — ${
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
