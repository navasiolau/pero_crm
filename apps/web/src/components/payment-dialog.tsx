"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatAmount, formatDate } from "@/lib/format";
import { addPayment } from "@/server/payments/actions";
import { fetchNbrbRate } from "@/server/finance/actions";
import type { CashAccountOption, ExpenseArticleOption } from "@/server/finance/contracts";
import type { FinanceDocumentView } from "@/server/finance-documents/contracts";
import { FinanceDocumentUpload } from "@/components/finance-document-upload";
import { createRequestId } from "@/lib/request-id";
const CURRENCIES = ["BYN", "RUB", "USD", "EUR"];

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
  const [clientMutationId, setClientMutationId] = useState(createRequestId);
  const [reportDocument, setReportDocument] = useState<FinanceDocumentView | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);

  // Сброс формы при каждом открытии
  useEffect(() => {
    if (open) {
      setClientMutationId(createRequestId());
      setReportDocument(null);
      setDocumentLoading(false);
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
  }, [open, projectCurrency, projectId, direction]);

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
    !documentLoading &&
    (isIncome || reportDocument !== null) &&
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
    <Dialog open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }}>
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
        <fieldset disabled={pending} className="flex min-w-0 max-w-full flex-col gap-3">
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
          {!isIncome ? <div className="min-w-0 space-y-2">
            <Label htmlFor="pay-document">Отчетный документ *</Label>
            <FinanceDocumentUpload key={clientMutationId} id="pay-document" disabled={pending}
              onBusyChange={setDocumentLoading} onUploaded={setReportDocument} />
          </div> : null}

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
        </fieldset>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              startTransition(async () => {
                try {
                const result = await addPayment({
                  clientMutationId,
                  ...(!isIncome && reportDocument ? { reportDocumentId: reportDocument.id } : {}),
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
                } catch {
                  toast.error("Не удалось подтвердить операцию. Повторите сохранение: идентификатор платежа сохранён.");
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
