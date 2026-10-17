"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { formatAmount, formatDate } from "@/lib/format";
import { usePaymentCreateCommand } from "@/components/use-payment-create-command";
import { stockPurchaseAmount } from "@/lib/warehouse-cost";
import { StockMaterialFields } from "@/components/stock-material-fields";
import type { StockMaterialOption } from "@/server/warehouse/contracts";
import { fetchNbrbRate } from "@/server/finance/actions";
import type { CashAccountOption, ExpenseArticleOption } from "@/server/finance/contracts";
import type { FinanceDocumentView } from "@/server/finance-documents/contracts";
import { FinanceDocumentUpload } from "@/components/finance-document-upload";
import { createRequestId } from "@/lib/request-id";
import { initialCashAccount } from "@/lib/cash-account-default";
import { ArticleDialog } from "@/components/article-dialog";
import { MaterialDialog } from "@/components/material-dialog";
import type { MaterialCreateOptions } from "@/server/warehouse/material-contracts";
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
  stockMaterials,
  materialCreateOptions,
}: {
  direction: "INCOME" | "EXPENSE";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | null;
  projectCurrency: string;
  projectOptions?: { id: string; number: string; title?: string }[];
  cashAccounts: CashAccountOption[];
  expenseArticles: ExpenseArticleOption[];
  stockMaterials?: StockMaterialOption[];
  materialCreateOptions?: MaterialCreateOptions;
}) {
  const isStockPurchase = stockMaterials !== undefined;
  const command = usePaymentCreateCommand(open, {kind: isStockPurchase ? "stock" : "payment", direction, projectId});
  const saved = command.intent && !("blocked" in command.intent) ? command.intent.command : undefined;
  const blocked = command.intent && "blocked" in command.intent ? command.intent.error : "";
  const isIncome = !isStockPurchase && direction === "INCOME";
  const [materialId, setMaterialId] = useState("");
  const [createdMaterials, setCreatedMaterials] = useState<StockMaterialOption[]>([]);
  const [materialOpen, setMaterialOpen] = useState(false);
  const materialCreateButton = useRef<HTMLButtonElement>(null);
  const materialOptions = [...new Map([...createdMaterials, ...(stockMaterials ?? [])].map(material => [material.id, material])).values()];
  useEffect(() => {
    setCreatedMaterials(current => {
      const remaining = current.filter(material => !stockMaterials?.some(server => server.id === material.id));
      return remaining.length === current.length ? current : remaining;
    });
  }, [stockMaterials]);
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [selectedProjectId,setSelectedProjectId]=useState(projectId??"");
  const hasProject = !isStockPurchase && Boolean(projectOptions ? selectedProjectId : projectId);
  const generalLabel = isIncome ? "Общий приход организации" : "Общий расход организации";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [currency, setCurrency] = useState(projectCurrency);
  const [cashAccountId, setCashAccountId] = useState("");
  const [articleId, setArticleId] = useState("");
  const [createdArticles, setCreatedArticles] = useState<ExpenseArticleOption[]>([]);
  const [articleOpen, setArticleOpen] = useState(false);
  const articleCreateButton = useRef<HTMLButtonElement>(null);
  const articleOptions = [...new Map([...createdArticles, ...expenseArticles].map(article => [article.id, article])).values()];
  // Локальная опция нужна до появления в серверных props, в том числе при быстром новом открытии.
  useEffect(() => {
    setCreatedArticles(current => {
      const remaining = current.filter(article => !expenseArticles.some(server => server.id === article.id));
      return remaining.length === current.length ? current : remaining;
    });
  }, [expenseArticles]);
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [rateDate, setRateDate] = useState("");
  const [rateLoading, setRateLoading] = useState(false);
  const [paidAt, setPaidAt] = useState("");
  const [comment, setComment] = useState("");
  const [clientMutationId, setClientMutationId] = useState(createRequestId);
  const [reportDocument, setReportDocument] = useState<FinanceDocumentView | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const initialized = useRef<{ session: object; actorId: string } | null>(null);

  // Обычный open сбрасывает draft; неизвестное намерение восстанавливается после current actor check.
  useEffect(() => {
    if (!open) { initialized.current = null; return; }
    if (open && !command.loading && command.actorId) {
      if (initialized.current?.session === command.session && initialized.current.actorId === command.actorId) return;
      initialized.current = { session: command.session, actorId: command.actorId };
      const restored = command.restored;
      if (restored) {
        const data = restored.data;
        setClientMutationId(data.clientMutationId); setCurrency(data.currency); setCashAccountId(data.cashAccountId);
        setArticleId(data.expenseArticleId ?? ""); setRate(data.rate === undefined ? "" : String(data.rate)); setRateDate(data.rateDate ?? "");
        setPaidAt(data.paidAt ?? ""); setComment(data.comment ?? ""); setDocumentLoading(false);
        if (restored.kind === "payment") {setSelectedProjectId(restored.data.projectId ?? ""); setAmount(String(restored.data.amount));}
        else {setMaterialId(restored.data.materialId); setQuantity(String(restored.data.quantity)); setUnitPrice(String(restored.data.unitPrice));}
        return;
      }
      setClientMutationId(createRequestId());
      setReportDocument(null);
      setDocumentLoading(false);
      setSelectedProjectId(projectId??"");
      const initial = initialCashAccount(cashAccounts, { currency: projectCurrency, fallback: "currency" });
      setCurrency(initial.currency);
      setCashAccountId(initial.cashAccountId);
      setArticleId("");
      setArticleOpen(false);
      setMaterialOpen(false);
      setAmount("");
      setMaterialId(""); setQuantity(""); setUnitPrice("");
      setRate("");
      setRateDate("");
      setPaidAt("");
      setComment("");
    }
  }, [open, projectCurrency, projectId, direction, isStockPurchase, cashAccounts, command.actorId, command.loading, command.restored, command.session]);

  // Курс НБ РБ — автоматически при смене валюты/даты (§11)
  useEffect(() => {
    if (saved || command.loading) {setRateLoading(false); return;}
    if (!open || currency === "BYN") {
      setRateLoading(false);
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
  }, [currency, paidAt, open, saved, command.loading]);

  const accountOptions = cashAccounts.filter(
    (account) => account.currency === currency,
  );
  const effectiveAccountId = accountOptions.some(account => account.id === cashAccountId) ? cashAccountId : "";
  const effectiveArticleId = isIncome
    ? ""
    : articleOptions.some((article) => article.id === articleId)
      ? articleId
      : (articleOptions[0]?.id ?? "");

  let purchaseAmount = "";
  if (isStockPurchase) { try { purchaseAmount = stockPurchaseAmount(quantity, unitPrice); } catch {} }
  const effectiveAmount = isStockPurchase ? purchaseAmount : amount;
  const parsedAmount = effectiveAmount.trim() === "" ? NaN : Number(effectiveAmount);
  const parsedRate = rate.trim() === "" ? NaN : Number(rate);
  const needsRate = currency !== "BYN";
  const bynPreview =
    needsRate && Number.isFinite(parsedAmount) && Number.isFinite(parsedRate)
      ? Math.round(parsedAmount * parsedRate * 100) / 100
      : null;

  const canSubmit =
    !pending &&
    !articleOpen &&
    !materialOpen &&
    !documentLoading &&
    (isIncome || isStockPurchase || reportDocument !== null) &&
    (!isStockPurchase || materialId !== "") &&
    (!needsRate || !rateLoading) &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    effectiveAccountId !== "" &&
    (isIncome || effectiveArticleId !== "") &&
    (!needsRate || (Number.isFinite(parsedRate) && parsedRate > 0));

  const articleField = !isIncome ? (
    <div className="flex min-w-0 max-w-full flex-col gap-1.5">
      <Label htmlFor="pay-article">Статья расхода *</Label>
      <SearchableSelect id="pay-article" value={effectiveArticleId} onChange={setArticleId}
        options={articleOptions.map(article => ({ value: article.id, label: article.name }))}
        disabled={pending || command.loading || !!saved || !!blocked}
        placeholder="Выберите статью…" searchPlaceholder="Поиск статьи…" />
      <Button ref={articleCreateButton} variant="outline" className="self-start" disabled={pending || command.loading || !!saved || !!blocked}
        onClick={() => setArticleOpen(true)}>Создать статью</Button>
      {articleOptions.length === 0 ? (
        <p className="text-xs text-destructive">
          Нет статей — создайте статью, чтобы продолжить
        </p>
      ) : null}
    </div>

  ) : null;

  return (
    <Dialog open={open} onOpenChange={next => { if (!pending && !articleOpen && !materialOpen) onOpenChange(next); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isStockPurchase ? "Приход на склад" : isIncome ? (hasProject ? "Приход по проекту" : "Приход организации") : (hasProject ? "Расход по проекту" : "Расход организации")}
          </DialogTitle>
          <DialogDescription>
            {isStockPurchase ? "Материал поступит на склад, сумма закупки спишется из выбранной кассы. Расход проекта возникнет при выдаче материала." : isIncome
              ? "Платёж попадёт в оборот месяца для «% от оборота»"
              : hasProject ? "Расход уменьшит маржу проекта" : "Расход уменьшит баланс организации и выбранной кассы"}
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={pending || command.loading || !!saved || !!blocked} className="flex min-w-0 max-w-full flex-col gap-3">
          {projectOptions && !isStockPurchase ? (
            <div className="flex min-w-0 max-w-full flex-col gap-1.5">
              <Label htmlFor="income-project">Проект (необязательно)</Label>
              <SearchableSelect id="income-project" value={selectedProjectId} onChange={setSelectedProjectId}
                disabled={pending} placeholder={generalLabel} searchPlaceholder="Номер проекта…"
                options={[{ value: "", label: generalLabel }, ...projectOptions.map(project => ({ value: project.id, label: project.number }))]} />
            </div>
          ) : null}
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 max-w-full flex-col gap-1.5">
              <Label>Валюта *</Label>
              <Select value={currency} onValueChange={(next) => {
                if (!next || next === currency) return;
                setCurrency(next);
                setCashAccountId(cashAccounts.find(account => account.currency === next)?.id ?? "");
              }}>
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

          {isStockPurchase ? <StockMaterialFields materials={materialOptions} materialId={materialId} onMaterialChange={setMaterialId} quantity={quantity} onQuantityChange={setQuantity} unitPrice={unitPrice} onPriceChange={setUnitPrice} currency={currency} prefix="purchase" disabled={pending || command.loading || !!saved || !!blocked}
            onCreateMaterial={materialCreateOptions ? () => setMaterialOpen(true) : undefined} createButtonRef={materialCreateButton} /> : null}
          {articleField}
          {!isIncome ? <div className="min-w-0 space-y-2">
            <Label htmlFor="pay-document">{isStockPurchase ? "Отчетный документ (необязательно)" : "Отчетный документ *"}</Label>
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
              value={effectiveAmount}
              readOnly={isStockPurchase}
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
        {saved ? <p role="status" className="text-sm text-destructive">Результат операции требует подтверждения. Проверьте прежний запрос.</p> : null}
        {saved?.data.reportDocumentId && !reportDocument ? <p className="text-sm text-muted-foreground">Отчётный документ закреплён в сохранённом запросе.</p> : null}
        {blocked || command.error ? <p role="alert" className="text-sm text-destructive">{blocked || command.error}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={pending || articleOpen || materialOpen} onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            disabled={pending || articleOpen || materialOpen || command.loading || !command.actorId || !!blocked || (!saved && !canSubmit)}
            onClick={() =>
              startTransition(async () => {
                try {
                const common = { clientMutationId, currency, cashAccountId: effectiveAccountId,
                  rate: needsRate ? parsedRate : undefined, rateDate: rateDate || undefined, paidAt: paidAt || undefined, comment: comment.trim() || undefined };
                const result = await command.run(saved ?? (isStockPurchase
                  ? {kind: "stock", data: { ...common, materialId, quantity, unitPrice, expenseArticleId: effectiveArticleId,
                    ...(reportDocument ? { reportDocumentId: reportDocument.id } : {}) }}
                  : {kind: "payment", data: { ...common,
                    ...(!isIncome && reportDocument ? { reportDocumentId: reportDocument.id } : {}),
                    projectId: projectOptions ? selectedProjectId || null : projectId ?? null, direction, amount: parsedAmount,
                    ...(!isIncome ? { expenseArticleId: effectiveArticleId } : {}),
                  }}));
                if (!result) return;
                if (result.ok) {
                  toast.success(isStockPurchase ? "Материал оплачен и принят на склад" : isIncome ? "Приход внесён" : "Расход внесён");
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
              : saved ? "Проверить"
              : isStockPurchase ? "Оплатить и принять на склад" : isIncome
                ? "Внести приход"
                : "Внести расход"}
          </Button>
        </DialogFooter>
        <ArticleDialog open={articleOpen} onOpenChange={setArticleOpen} returnFocus={articleCreateButton}
          onCreated={article => {
            setCreatedArticles(current => [...current.filter(item => item.id !== article.id), article]);
            setArticleId(article.id);
          }} />
        {materialCreateOptions && isStockPurchase ? <MaterialDialog open={materialOpen} onOpenChange={setMaterialOpen} {...materialCreateOptions} returnFocus={materialCreateButton}
          onCreated={material => {
            setCreatedMaterials(current => [...current.filter(item => item.id !== material.id), material]);
            setMaterialId(material.id);
          }} /> : null}
      </DialogContent>
    </Dialog>
  );
}
