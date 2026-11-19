"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { formatExactMoney, formatQty } from "@/lib/format";
import { applyExpenseIssue, getExpenseIssueChoices, previewExpenseIssue } from "@/server/warehouse/expense-issue-actions";
import type { ExpenseIssueChoice, ExpenseIssueSourceLine } from "@/server/warehouse/expense-issue-contracts";

type Quote = Extract<Awaited<ReturnType<typeof previewExpenseIssue>>, { ok: true }>;
const options = (choices: ExpenseIssueChoice[]) => choices.map(row => ({ value: row.id, label: row.label }));

export function ExpenseReceiptIssueDialog({ paymentId, onApplied }: { paymentId: string; onApplied: () => void }) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<ExpenseIssueSourceLine[]>([]);
  const [projects, setProjects] = useState<ExpenseIssueChoice[]>([]);
  const [products, setProducts] = useState<ExpenseIssueChoice[]>([]);
  const [projectId, setProjectId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [quote, setQuote] = useState<Quote | null>(null);
  const [requestId, setRequestId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function loadChoices(projectId?: string) {
    setPending(true);
    try {
      const result = await getExpenseIssueChoices({ paymentId, ...(projectId ? { projectId } : {}) });
      if (!result.ok) { setError(result.error); return; }
      setSources(result.sources);
      if (projectId) setProducts(result.choices); else setProjects(result.choices);
    } catch { setError("Не удалось открыть строки чека"); }
    finally { setPending(false); }
  }

  function begin() {
    setError("");
    setProjectId("");
    setProductId("");
    setQuantities({});
    setSources([]);
    setProjects([]);
    setProducts([]);
    setQuote(null);
    setOpen(true);
    void loadChoices();
  }

  function chooseProject(project: string) {
    setProjectId(project);
    setProductId("");
    setProducts([]);
    setQuote(null);
    setError("");
    if (project) void loadChoices(project);
  }

  const lines = Object.entries(quantities).flatMap(([sourceMovementId, quantity]) =>
    quantity.trim() ? [{ sourceMovementId, quantity }] : []);
  const ready = Boolean(projectId && productId && lines.length);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !ready) return;
    const input = { paymentId, projectId, productId, lines };
    setPending(true);
    setError("");
    try {
      if (!quote) {
        const result = await previewExpenseIssue(input);
        if (!result.ok) { setError(result.error); return; }
        setQuote(result);
        setRequestId(crypto.randomUUID());
        return;
      }
      const result = await applyExpenseIssue({ ...input, requestId, fingerprint: quote.fingerprint });
      if (!result.ok) {
        setError(result.error);
        if (result.error.includes("Рассчитайте")) setQuote(null);
        return;
      }
      setOpen(false);
      onApplied();
      router.refresh();
      toast.success("Материалы выданы на изделие");
    } catch { setError("Не удалось подтвердить ответ. Повторите запрос с теми же данными"); }
    finally { setPending(false); }
  }

  return <>
    <Button type="button" variant="outline" onClick={begin}>Выдать на изделие</Button>
    <Dialog open={open} onOpenChange={value => { if (!pending) setOpen(value); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form className="space-y-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Выдать материалы по чеку</DialogTitle>
            <DialogDescription>Выдача уменьшит складской остаток и учтёт себестоимость в выбранном изделии.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={id + "-project"} className="text-sm">Проект</label>
              <SearchableSelect id={id + "-project"} options={options(projects)} value={projectId} onChange={chooseProject} disabled={pending} searchPlaceholder="Поиск проекта" />
            </div>
            <div className="space-y-1">
              <label htmlFor={id + "-product"} className="text-sm">Изделие проекта</label>
              <SearchableSelect id={id + "-product"} options={options(products)} value={productId} disabled={pending || !projectId}
                onChange={value => { setProductId(value); setQuote(null); }} searchPlaceholder="Поиск изделия" />
            </div>
          </div>
          <div className="space-y-2">
            {sources.map(row => <div className="grid gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1fr)_8rem]" key={row.movementId}>
              <div>
                <p className="text-sm font-medium">{row.materialName}</p>
                <p className="text-xs text-muted-foreground">По чеку {formatQty(row.receiptQuantity)} {row.unit} · выдано {formatQty(row.issuedQuantity)} · доступно по чеку {formatQty(row.remainingQuantity)}</p>
              </div>
              <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                Количество
                <Input inputMode="decimal" maxLength={32} aria-label={"Количество · " + row.materialName}
                  disabled={pending || Number(row.remainingQuantity) === 0} value={quantities[row.movementId] ?? ""}
                  onChange={event => {
                    setQuantities(previous => ({ ...previous, [row.movementId]: event.target.value }));
                    setQuote(null);
                  }}/>
              </label>
            </div>)}
          </div>
          {quote ? <div className="space-y-1 rounded-md border p-3 text-sm" aria-label="Расчёт выдачи">
            {quote.lines.map(line => <p key={line.movementId}>{line.materialName} · {formatQty(line.quantity)} {line.unit} · {formatExactMoney(line.moneyByn, "BYN")}
              <span className="text-muted-foreground"> · остаток склада {formatQty(line.warehouseBefore)} → {formatQty(line.warehouseAfter)} {line.unit}</span></p>)}
            <p className="font-semibold">Стоимость выдачи {formatExactMoney(quote.totalByn, "BYN")}</p>
          </div> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Закрыть</Button>
            <Button type="submit" disabled={pending || !ready}>{quote ? "Подтвердить выдачу" : "Рассчитать выдачу"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
