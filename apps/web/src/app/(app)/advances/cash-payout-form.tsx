"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { createRequestId } from "@/lib/request-id";
import { formatAmount } from "@/lib/format";
import { isCashCurrency, type CashCurrency } from "@/lib/cash-ledger";
import { addPayout } from "@/server/payroll/actions";
import { issueAdvance, previewCashPayout } from "@/server/payroll/cash-actions";
import { buildSalaryPayoutRetry, salaryRetryBlockedByLimit, type FrozenCashPayoutRequest } from "./cash-payout-operation";

type EmployeeOption = { id: string; name: string; position: string | null };
type CashAccountOption = { id: string; name: string; currency: string; active: boolean; balance: number };
type CashPreview = {
  amount: string;
  payrollCurrency: CashCurrency;
  cashAmount: string;
  cashCurrency: CashCurrency;
  bynAmount: string;
  cashRate: string;
  cashRateDate: string;
  payrollRate: string;
  payrollRateDate: string;
};
type Mode = "ADVANCE" | "SALARY";
type PayoutPayload = {
  userId: string;
  cashAccountId: string;
  cashAmount: string;
  expectedCashCurrency: CashCurrency;
  description: string;
};
type SuccessReceipt = {
  cashAmount: string | null;
  cashCurrency: string | null;
  payrollAmount: string | null;
  payrollCurrency: string | null;
  repeated: boolean;
};

export function CashPayoutForm({
  mode,
  users,
  accounts,
  month,
  dues,
  orgBalance,
  salaryCurrency = "BYN",
  estimates,
  onClose,
  onUncertainChange,
}: {
  mode: Mode;
  users: EmployeeOption[];
  accounts: CashAccountOption[];
  month?: string;
  dues?: { userId: string; due: number | null }[];
  orgBalance?: number | null;
  salaryCurrency?: string;
  estimates?: Record<string, number | null>;
  onClose?: () => void;
  onUncertainChange?: (uncertain: boolean) => void;
}) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [description, setDescription] = useState("");
  const [preview, setPreview] = useState<{ key: string; value: CashPreview } | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uncertain, setUncertain] = useState<FrozenCashPayoutRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SuccessReceipt | null>(null);

  const account = accounts.find((item) => item.id === cashAccountId);
  const employeeDue = dues?.find((row) => row.userId === userId)?.due ?? null;
  const salaryLimit = dues && employeeDue !== null && orgBalance !== null && orgBalance !== undefined
    ? Math.round(Math.min(employeeDue, orgBalance) * 100) / 100
    : null;
  const validCurrency = account && isCashCurrency(account.currency)
    ? account.currency
    : null;
  const formKey = JSON.stringify([userId, cashAccountId, validCurrency, cashAmount, description.trim()]);
  const currentPreview = preview?.key === formKey ? preview.value : null;
  const amountValid = /^\d+(?:\.\d{1,2})?$/.test(cashAmount) && Number(cashAmount) > 0;
  const descriptionValid = mode !== "ADVANCE" || description.trim().length > 0;
  const canPreview = Boolean(userId && account?.active && validCurrency && amountValid && descriptionValid) &&
    Number(cashAmount) <= (account?.balance ?? 0) && !(mode === "SALARY" && dues && salaryLimit === null);
  const salaryLimitExceeded = mode === "SALARY" && currentPreview && salaryLimit !== null && salaryLimit !== undefined &&
    Number(currentPreview.amount) > salaryLimit;
  const advanceEstimate = estimates?.[userId] ?? null;
  const advanceEstimateExceeded = mode === "ADVANCE" && currentPreview && advanceEstimate !== null &&
    Number(currentPreview.amount) > advanceEstimate;
  const locked = submitting || uncertain !== null || receipt !== null;

  function clearPreview() {
    setPreview(null);
    setError(null);
  }

  async function getPreview() {
    if (!canPreview || !account || !validCurrency || locked) return;
    const requestedKey = formKey;
    setChecking(true);
    setError(null);
    try {
      const result = await previewCashPayout({
        cashAccountId: account.id,
        cashAmount,
        expectedCashCurrency: validCurrency,
      });
      if (!result.ok) {
        setError(result.error ?? "Не удалось рассчитать сумму");
      } else {
        setPreview({ key: requestedKey, value: result.preview });
      }
    } catch {
      setError("Не удалось получить расчёт. Проверьте соединение и повторите.");
    } finally {
      setChecking(false);
    }
  }

  async function submit(frozen: FrozenCashPayoutRequest | null = uncertain) {
    if (submitting) return;
    const payload: PayoutPayload | null = frozen?.payload ?? (
      currentPreview && account && validCurrency && userId
        ? { userId, cashAccountId, cashAmount, expectedCashCurrency: validCurrency, description: description.trim() }
        : null
    );
    if (!frozen && mode === "SALARY" && dues && salaryLimit === null) return;
    if (!payload || salaryRetryBlockedByLimit(Boolean(frozen), Boolean(salaryLimitExceeded))) return;
    const operation: FrozenCashPayoutRequest = frozen ?? {
      mode,
      payload,
      requestId: createRequestId(),
      month: mode === "SALARY" ? (month ?? new Date().toISOString().slice(0, 7)) : undefined,
    };
    setSubmitting(true);
    onUncertainChange?.(true);
    setError(null);
    try {
      const result = operation.mode === "ADVANCE"
        ? await issueAdvance({ ...operation.payload, requestId: operation.requestId })
        : await addPayout(buildSalaryPayoutRetry(operation, month ?? new Date().toISOString().slice(0, 7)));
      if (!result.ok) {
        setUncertain(null);
        onUncertainChange?.(false);
        setPreview(null);
        setError(result.error ?? "Операция отклонена. Проверьте данные и повторите.");
        return;
      }
      setReceipt({
        cashAmount: result.cashAmount ?? null,
        cashCurrency: result.cashCurrency ?? null,
        payrollAmount: result.payrollAmount ?? null,
        payrollCurrency: result.payrollCurrency ?? null,
        repeated: Boolean(result.repeated),
      });
      setUserId("");
      setCashAccountId("");
      setCashAmount("");
      setDescription("");
      setPreview(null);
      setUncertain(null);
      onUncertainChange?.(false);
      router.refresh();
    } catch {
      setUncertain(operation);
      onUncertainChange?.(true);
      setError("Ответ не получен. Данные операции зафиксированы; повторите тот же запрос.");
    } finally {
      setSubmitting(false);
    }
  }

  function startNewOperation() {
    setReceipt(null);
    setUserId("");
    setCashAccountId("");
    setCashAmount("");
    setDescription("");
    setPreview(null);
    setUncertain(null);
    onUncertainChange?.(false);
    setError(null);
  }

  if (receipt) {
    return (
      <div className="flex flex-col gap-4" role="status" aria-live="polite">
        <div className="flex items-start gap-3 rounded-lg border border-green-600/30 bg-green-600/5 p-4">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-green-700 dark:text-green-400" />
          <div className="min-w-0">
            <p className="font-semibold">{mode === "ADVANCE" ? "Аванс выдан" : "Выплата внесена"}{receipt.repeated ? " (повтор операции)" : ""}</p>
            {receipt.cashAmount && receipt.cashCurrency ? <p className="mt-1 break-words text-sm">Выдано: {formatAmount(receipt.cashAmount, receipt.cashCurrency)}</p> : null}
            {receipt.payrollAmount && receipt.payrollCurrency ? <p className="break-words text-sm">По зарплате: {formatAmount(receipt.payrollAmount, receipt.payrollCurrency)}</p> : null}
            {!receipt.cashAmount || !receipt.cashCurrency || !receipt.payrollAmount || !receipt.payrollCurrency ? <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">Выдача сохранена, но итоговые суммы не пришли в ответе. Обновите страницу и проверьте журнал выплат.</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-12 h-auto whitespace-normal" onClick={startNewOperation}>
            <RotateCcw className="size-4" /> Новая операция
          </Button>
          {onClose ? <Button className="min-h-12 h-auto whitespace-normal" variant="outline" onClick={onClose}>Закрыть</Button> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {uncertain ? (
        <div className="rounded-lg border border-amber-600/35 bg-amber-500/5 p-3 text-sm">
          Операция ожидает подтверждения: {users.find((item) => item.id === uncertain.payload.userId)?.name ?? "сотрудник"}, {formatAmount(uncertain.payload.cashAmount, uncertain.payload.expectedCashCurrency)} из кассы «{accounts.find((item) => item.id === uncertain.payload.cashAccountId)?.name ?? "выбрана"}».
          Поля заблокированы, чтобы повторить тот же запрос без риска двойной выдачи.
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label>Сотрудник *</Label>
        <SearchableSelect
          options={users.map((item) => ({ value: item.id, label: item.name, hint: item.position ?? undefined }))}
          value={userId}
          onChange={(value) => { setUserId(value); clearPreview(); }}
          placeholder="Выберите сотрудника…"
          searchPlaceholder="Поиск по ФИО и должности…"
          className="min-h-12 h-auto whitespace-normal text-left"
          disabled={locked || checking}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Касса *</Label>
        <SearchableSelect
          options={accounts.filter((item) => item.active).map((item) => ({
            value: item.id,
            label: `${item.name} · ${item.currency}`,
            hint: `Доступно ${formatAmount(item.balance, item.currency)}`,
          }))}
          value={cashAccountId}
          onChange={(value) => {
            setCashAccountId(value);
            setCashAmount("");
            clearPreview();
          }}
          placeholder="Выберите кассу…"
          searchPlaceholder="Поиск кассы…"
          className="min-h-12 h-auto whitespace-normal text-left"
          disabled={locked || checking}
        />
        {account ? <p className="text-xs text-muted-foreground">Остаток: {formatAmount(account.balance, account.currency)}</p> : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cash-payout-amount">Сумма выдачи{validCurrency ? `, ${validCurrency}` : ""} *</Label>
        <Input
          id="cash-payout-amount"
          className="min-h-12"
          inputMode="decimal"
          type="number"
          min="0.01"
          step="0.01"
          value={cashAmount}
          onChange={(event) => { setCashAmount(event.target.value); clearPreview(); }}
          placeholder="0.00"
          disabled={locked || checking || !account}
        />
        {account && Number(cashAmount) > account.balance ? (
          <p className="text-xs text-destructive">Сумма выше остатка кассы {formatAmount(account.balance, account.currency)}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cash-payout-description">{mode === "ADVANCE" ? "Описание работы *" : "Комментарий"}</Label>
        <textarea
          id="cash-payout-description"
          className="min-h-24 w-full resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          value={description}
          onChange={(event) => { setDescription(event.target.value); clearPreview(); }}
          placeholder={mode === "ADVANCE" ? "За какую работу выдаётся аванс" : "Например, окончательный расчёт"}
          disabled={locked || checking}
        />
      </div>

      {mode === "SALARY" && dues && salaryLimit === null ? <p className="text-xs text-destructive">Выплата недоступна: нет подтверждённого BYN-эквивалента долга или баланса.</p> : null}
      {mode === "SALARY" && userId && salaryLimit !== null ? (
        <p className="text-xs text-muted-foreground">Доступно по долгу и балансу организации: {formatAmount(salaryLimit, currentPreview?.payrollCurrency ?? salaryCurrency)}</p>
      ) : null}

      {currentPreview ? (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <h3 className="font-semibold">Предварительный расчёт</h3>
          <dl className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
            <dt>Физическая сумма</dt><dd className="text-right font-medium">{formatAmount(currentPreview.cashAmount, currentPreview.cashCurrency)}</dd>
            <dt>Эквивалент зарплаты</dt><dd className="text-right font-medium">{formatAmount(currentPreview.amount, currentPreview.payrollCurrency)}</dd>
            <dt>Эквивалент BYN</dt><dd className="text-right">{formatAmount(currentPreview.bynAmount, "BYN")}</dd>
            <dt>Курс кассы на {currentPreview.cashRateDate}</dt><dd className="text-right">{currentPreview.cashRate} BYN/{currentPreview.cashCurrency}</dd>
            <dt>Курс зарплаты на {currentPreview.payrollRateDate}</dt><dd className="text-right">{currentPreview.payrollRate} BYN/{currentPreview.payrollCurrency}</dd>
          </dl>
          {salaryLimitExceeded ? <p className="mt-2 text-destructive">Эквивалент превышает доступный долг или баланс организации.</p> : null}
          {advanceEstimateExceeded ? <p className="mt-2 text-amber-700 dark:text-amber-400">Сумма выше текущей приблизительной зарплаты ({formatAmount(advanceEstimate, currentPreview.payrollCurrency)}). Это предупреждение: оценка может вырасти до закрытия месяца.</p> : null}
          <p className="mt-2 text-xs text-muted-foreground">Подтвердите выдачу после проверки суммы и курсов.</p>
        </div>
      ) : null}

      {error ? <p className="flex items-start gap-2 text-sm text-destructive" role="alert"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        {uncertain ? (
          <Button className="min-h-12 h-auto whitespace-normal" disabled={submitting} onClick={() => void submit(uncertain)}>
            {submitting ? "Проверяем операцию…" : "Повторить тот же запрос"}
          </Button>
        ) : currentPreview ? (
          <Button className="min-h-12 h-auto whitespace-normal" disabled={submitting || checking || Boolean(salaryLimitExceeded) || Boolean(mode === "SALARY" && dues && salaryLimit === null)} onClick={() => void submit(null)}>
            {submitting ? "Сохранение…" : mode === "ADVANCE" ? "Подтвердить и выдать аванс" : "Подтвердить выплату"}
          </Button>
        ) : (
          <Button className="min-h-12 h-auto whitespace-normal" disabled={!canPreview || checking || locked} onClick={() => void getPreview()}>
            {checking ? "Рассчитываем…" : "Рассчитать и проверить сумму"}
          </Button>
        )}
        {onClose && !uncertain ? <Button className="min-h-12 h-auto whitespace-normal" variant="outline" disabled={submitting} onClick={onClose}>Отмена</Button> : null}
      </div>
    </div>
  );
}
