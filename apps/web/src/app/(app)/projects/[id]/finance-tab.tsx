"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { formatAmount, formatMoneyTotal, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addPayment, deletePayment } from "@/server/payments/actions";
import { fetchNbrbRate } from "@/server/finance/actions";

export type PaymentRow = {
  id: string;
  direction: "INCOME" | "EXPENSE";
  amount: number; // в валюте операции
  currency: string;
  rate: number; // BYN за единицу валюты (курс НБ РБ / ручной)
  bynAmount: number;
  projectAmount: number | null; // эквивалент в валюте проекта
  paidAt: string;
  comment: string | null;
  cashAccountName: string | null;
  expenseArticleName: string | null;
  createdByName: string | null;
};

export type ProjectEconomicsView = {
  expectedPrice: number | null;
  paidTotal: number | null;
  expensesTotal: number | null;
  payrollTotal: number | null;
  margin: number | null;
  marginAtFullPrice: number | null;
  expenseBreakdown: { label: string; amount: number | null }[];
};

export type CashAccountOption = { id: string; name: string; currency: string };
export type ExpenseArticleOption = { id: string; name: string };

const CURRENCIES = ["BYN", "RUB", "USD", "EUR"];

// Вкладка «Финансы» проекта (§11, только админ/директор): экономика
// (ожидаемая цена, оплаты, расходы = ЗП + статьи, маржа с индикатором),
// приходы и расходы в любой из 4 валют с курсом НБ РБ в записи.
export function FinanceTab({
  projectId,
  currency,
  economics,
  payments,
  cashAccounts,
  expenseArticles,
  canEdit = true,
}: {
  canEdit?: boolean;
  projectId: string;
  currency: string;
  economics: ProjectEconomicsView;
  payments: PaymentRow[];
  cashAccounts: CashAccountOption[];
  expenseArticles: ExpenseArticleOption[];
}) {
  const [dialogDirection, setDialogDirection] = useState<
    "INCOME" | "EXPENSE" | null
  >(null);
  const [deleting, setDeleting] = useState<PaymentRow | null>(null);
  const router = useRouter();

  const incomes = payments.filter((payment) => payment.direction === "INCOME");
  const expenses = payments.filter((payment) => payment.direction === "EXPENSE");

  function amountCell(row: PaymentRow) {
    return (
      <div className="flex flex-col items-end">
        <span>{formatAmount(row.amount, row.currency)}</span>
        {row.currency !== "BYN" ? (
          <span className="text-xs text-muted-foreground">
            {formatAmount(row.bynAmount, "BYN")} по курсу {row.rate}
          </span>
        ) : null}
      </div>
    );
  }

  function buildColumns(withArticle: boolean): DataColumn<PaymentRow>[] {
    const columns: DataColumn<PaymentRow>[] = [
      {
        id: "date",
        header: "Дата",
        sortable: true,
        sortValue: (row) => row.paidAt,
        cell: (row) => formatDate(row.paidAt),
      },
    ];
    if (withArticle) {
      columns.push({
        id: "article",
        header: "Статья",
        sortable: true,
        sortValue: (row) => row.expenseArticleName ?? "",
        cell: (row) => row.expenseArticleName ?? "—",
      });
    }
    columns.push(
      {
        id: "account",
        header: "Касса",
        sortable: true,
        sortValue: (row) => row.cashAccountName ?? "",
        cell: (row) => (
          <span className="text-muted-foreground">
            {row.cashAccountName ?? "—"}
          </span>
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
          <span className="text-muted-foreground">
            {row.createdByName ?? "—"}
          </span>
        ),
      },
      {
        id: "amount",
        header: "Сумма",
        sortable: true,
        sortValue: (row) => row.bynAmount,
        className: "text-right font-medium",
        headerClassName: "text-right",
        cell: amountCell,
      },
      {
        id: "actions",
        header: "",
        className: "w-10",
        cell: (row) => canEdit ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={row.direction === "INCOME" ? "Удалить приход" : "Удалить расход"}
            onClick={(event) => {
              event.stopPropagation();
              setDeleting(row);
            }}
          >
            <Trash2 className="size-4 text-muted-foreground" />
          </Button>
        ) : null,
      },
    );
    return columns;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Экономика проекта (§11) */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ожидаемая цена
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {economics.expectedPrice !== null
                ? formatMoneyTotal(economics.expectedPrice, "BYN")
                : formatMoneyTotal(null)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Оплачено
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatMoneyTotal(economics.paidTotal, "BYN")}
            </div>
            {economics.expectedPrice !== null && economics.paidTotal !== null ? (
              <p className="text-xs text-muted-foreground">
                осталось{" "}
                {formatAmount(
                  Math.max(0, economics.expectedPrice - economics.paidTotal),
                  "BYN",
                )}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Расходы
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatMoneyTotal(
                economics.expensesTotal === null || economics.payrollTotal === null ? null : economics.expensesTotal + economics.payrollTotal,
                "BYN",
              )}
            </div>
            {economics.expenseBreakdown.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {economics.expenseBreakdown
                  .map((item) => `${item.label}: ${formatMoneyTotal(item.amount, "BYN")}`)
                  .join(" · ")}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Маржа
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={cn(
                "text-2xl font-semibold",
                economics.margin === null ? "" : economics.margin >= 0 ? "text-green-600" : "text-red-600",
              )}
            >
              {formatMoneyTotal(economics.margin, "BYN")}
            </div>
            {economics.marginAtFullPrice !== null ? (
              <p className="text-xs text-muted-foreground">
                при полной оплате:{" "}
                <span
                  className={cn(
                    economics.marginAtFullPrice >= 0
                      ? "text-green-600"
                      : "text-red-600",
                  )}
                >
                  {formatMoneyTotal(economics.marginAtFullPrice, "BYN")}
                </span>
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Приходы */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Приходы</h3>
          <Button disabled={!canEdit} onClick={() => setDialogDirection("INCOME")}>
            <Plus className="size-4" />
            Добавить приход
          </Button>
        </div>
        <DataTable
          columns={buildColumns(false)}
          rows={incomes}
          searchPlaceholder="Поиск по приходам…"
          emptyText="Приходов по проекту пока нет"
        />
      </div>

      {/* Расходы */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Расходы</h3>
          <Button
            variant="outline"
            disabled={!canEdit}
            onClick={() => setDialogDirection("EXPENSE")}
          >
            <Plus className="size-4" />
            Добавить расход
          </Button>
        </div>
        <DataTable
          columns={buildColumns(true)}
          rows={expenses}
          searchPlaceholder="Поиск по расходам…"
          emptyText="Расходов по проекту пока нет"
        />
        <p className="text-xs text-muted-foreground">
          Зарплата учитывается в марже автоматически из начислений по задачам
          проекта — вносить её расходом не нужно.
        </p>
      </div>

      <PaymentDialog
        direction={dialogDirection ?? "INCOME"}
        open={canEdit && dialogDirection !== null}
        onOpenChange={(open) => {
          if (!open) setDialogDirection(null);
        }}
        projectId={projectId}
        projectCurrency={currency}
        cashAccounts={cashAccounts}
        expenseArticles={expenseArticles}
      />

      <ConfirmDeleteDialog
        entityLabel={deleting?.direction === "EXPENSE" ? "расход" : "приход"}
        open={canEdit && deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        warning={
          deleting
            ? `${formatAmount(deleting.amount, deleting.currency)} — ${
                deleting.direction === "INCOME"
                  ? "оборот месяца уменьшится"
                  : "маржа проекта изменится"
              }.`
            : undefined
        }
        onConfirm={async () => {
          if (!deleting) return false;
          const result = await deletePayment(deleting.id);
          if (result.ok) {
            toast.success(
              deleting.direction === "INCOME"
                ? "Приход удалён"
                : "Расход удалён",
            );
            router.refresh();
            return true;
          }
          toast.error(result.error ?? "Ошибка удаления");
          return false;
        }}
      />
    </div>
  );
}

// Диалог внесения прихода/расхода (§11): валюта, касса в валюте операции,
// курс НБ РБ (подтягивается автоматически, можно поправить вручную),
// эквивалент BYN. Эквивалент в валюте проекта считает сервер.
export function PaymentDialog({
  direction,
  open,
  onOpenChange,
  projectId,
  projectCurrency,
  projectOptions,
  cashAccounts,
  expenseArticles,
}: {
  direction: "INCOME" | "EXPENSE";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | null;
  projectCurrency: string;
  projectOptions?: { id: string; number: string; title?: string }[];
  cashAccounts: CashAccountOption[];
  expenseArticles: ExpenseArticleOption[];
}) {
  const isIncome = direction === "INCOME";
  const [selectedProjectId,setSelectedProjectId]=useState(projectId??"");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [currency, setCurrency] = useState(projectCurrency);
  const [cashAccountId, setCashAccountId] = useState("");
  const [articleId, setArticleId] = useState("");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [rateDate, setRateDate] = useState("");
  const [rateLoading, setRateLoading] = useState(false);
  const [paidAt, setPaidAt] = useState("");
  const [comment, setComment] = useState("");

  // Сброс формы при каждом открытии
  useEffect(() => {
    if (open) {
      setSelectedProjectId(projectId??"");
      setCurrency(projectCurrency);
      setCashAccountId("");
      setArticleId("");
      setAmount("");
      setRate("");
      setRateDate("");
      setPaidAt("");
      setComment("");
    }
  }, [open, projectCurrency, projectId]);

  // Курс НБ РБ — автоматически при смене валюты/даты (§11)
  useEffect(() => {
    if (!open || currency === "BYN") {
      setRate("");
      setRateDate("");
      return;
    }
    let cancelled = false;
    setRateLoading(true);
    fetchNbrbRate(currency, paidAt || undefined).then((result) => {
      if (cancelled) return;
      setRateLoading(false);
      if (result.ok && result.rate !== undefined) {
        setRate(String(result.rate));
        setRateDate(result.date ?? "");
      } else {
        setRate("");
        setRateDate("");
        toast.error(result.error ?? "Не удалось получить курс НБ РБ");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [currency, paidAt, open]);

  const accountOptions = cashAccounts.filter(
    (account) => account.currency === currency,
  );
  const effectiveAccountId = accountOptions.some(
    (account) => account.id === cashAccountId,
  )
    ? cashAccountId
    : (accountOptions[0]?.id ?? "");
  const effectiveArticleId = isIncome
    ? ""
    : expenseArticles.some((article) => article.id === articleId)
      ? articleId
      : (expenseArticles[0]?.id ?? "");

  const parsedAmount = amount.trim() === "" ? NaN : Number(amount);
  const parsedRate = rate.trim() === "" ? NaN : Number(rate);
  const needsRate = currency !== "BYN";
  const bynPreview =
    needsRate && Number.isFinite(parsedAmount) && Number.isFinite(parsedRate)
      ? Math.round(parsedAmount * parsedRate * 100) / 100
      : null;

  const canSubmit =
    !pending &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    effectiveAccountId !== "" &&
    (isIncome || effectiveArticleId !== "") &&
    (!needsRate || (Number.isFinite(parsedRate) && parsedRate > 0));

  const articleField = !isIncome ? (
    <div className="flex min-w-0 max-w-full flex-col gap-1.5">
      <Label htmlFor="pay-article">Статья расхода *</Label>
      <Select
        value={effectiveArticleId}
        onValueChange={(next) => setArticleId(next ?? "")}
      >
        <SelectTrigger id="pay-article" className="w-full min-w-0 max-w-full">
          <SelectValue className="min-w-0 flex-1 truncate">
            {expenseArticles.find(
              (article) => article.id === effectiveArticleId,
            )?.name ?? "—"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {expenseArticles.map((article) => (
            <SelectItem key={article.id} value={article.id}>
              {article.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {expenseArticles.length === 0 ? (
        <p className="text-xs text-destructive">
          Нет статей — создайте их в Финансы → Статьи расходов
        </p>
      ) : null}
    </div>

  ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isIncome ? (projectOptions ? "Приход организации" : "Приход по проекту") : "Расход по проекту"}
          </DialogTitle>
          <DialogDescription>
            {isIncome
              ? "Платёж попадёт в оборот месяца для «% от оборота»"
              : "Расход уменьшит маржу проекта"}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 max-w-full flex-col gap-3">
          {projectOptions ? (
            <div className="flex min-w-0 max-w-full flex-col gap-1.5">
              <Label htmlFor="income-project">Проект (необязательно)</Label>
              <select
                id="income-project"
                className="h-10 w-full min-w-0 max-w-full rounded-md border bg-background px-3"
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectId(event.target.value)}
              >
                <option value="">Общий приход организации</option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>{project.number}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 max-w-full flex-col gap-1.5">
              <Label>Валюта *</Label>
              <Select value={currency} onValueChange={(next) => setCurrency(next ?? currency)}>
                <SelectTrigger className="w-full min-w-0 max-w-full">
                  <SelectValue className="min-w-0 flex-1 truncate">{currency}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-0 max-w-full flex-col gap-1.5">
              <Label>Касса *</Label>
              <Select
                value={effectiveAccountId}
                onValueChange={(next) => setCashAccountId(next ?? "")}
              >
                <SelectTrigger className="w-full min-w-0 max-w-full">
                  <SelectValue className="min-w-0 flex-1 truncate">
                    {accountOptions.find(
                      (account) => account.id === effectiveAccountId,
                    )?.name ?? "—"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {accountOptions.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {accountOptions.length === 0 ? (
                <p className="text-xs text-destructive">
                  Нет кассы в {currency} — создайте её в Финансы → Кассы
                </p>
              ) : null}
            </div>
          </div>

          {articleField}

          <div className="flex min-w-0 max-w-full flex-col gap-1.5">
            <Label htmlFor="pay-amount">Сумма, {currency} *</Label>
            <Input
              className="w-full min-w-0 max-w-full"
              id="pay-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
            />
          </div>

          {needsRate ? (
            <div className="flex min-w-0 max-w-full flex-col gap-1.5">
              <Label htmlFor="pay-rate">Курс НБ РБ (BYN за 1 {currency}) *</Label>
              <Input
                className="w-full min-w-0 max-w-full"
              id="pay-rate"
                type="number"
                min="0"
                step="0.000001"
                value={rate}
                disabled={rateLoading}
                onChange={(event) => setRate(event.target.value)}
                placeholder={rateLoading ? "Загрузка курса…" : "0.00"}
              />
              <p className="text-xs text-muted-foreground">
                {rateDate
                  ? `Подтянут с НБ РБ на ${formatDate(rateDate)} — можно поправить вручную`
                  : "Введите курс вручную"}
                {bynPreview !== null
                  ? ` · эквивалент ≈ ${formatAmount(bynPreview, "BYN")}`
                  : ""}
              </p>
            </div>
          ) : null}

          <div className="flex min-w-0 max-w-full flex-col gap-1.5">
            <Label htmlFor="pay-date">Дата</Label>
            <Input
              className="w-full min-w-0 max-w-full"
              id="pay-date"
              type="date"
              value={paidAt}
              onChange={(event) => setPaidAt(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">Пусто — сегодня</p>
          </div>
          <div className="flex min-w-0 max-w-full flex-col gap-1.5">
            <Label htmlFor="pay-comment">Комментарий</Label>
            <Input
              className="w-full min-w-0 max-w-full"
              id="pay-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={isIncome ? "Комментарий к приходу" : "Закупка материалов…"}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              startTransition(async () => {
                const result = await addPayment({
                  projectId: projectOptions ? selectedProjectId || null : projectId ?? null,
                  direction,
                  amount: parsedAmount,
                  currency,
                  cashAccountId: effectiveAccountId,
                  ...(!isIncome ? { expenseArticleId: effectiveArticleId } : {}),
                  rate: needsRate ? parsedRate : undefined,
                  rateDate: rateDate || undefined,
                  paidAt: paidAt || undefined,
                  comment: comment.trim() || undefined,
                });
                if (result.ok) {
                  toast.success(isIncome ? "Приход внесён" : "Расход внесён");
                  onOpenChange(false);
                  router.refresh();
                } else {
                  toast.error(result.error ?? "Ошибка");
                }
              })
            }
          >
            {pending
              ? "Сохранение…"
              : isIncome
                ? "Внести приход"
                : "Внести расход"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
