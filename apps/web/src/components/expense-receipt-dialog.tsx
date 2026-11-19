"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StockMaterialPicker } from "@/components/stock-material-fields";
import { formatAmount, formatQty } from "@/lib/format";
import { applyExpenseReceipt, previewExpenseReceipt } from "@/server/warehouse/expense-receipt-actions";
import type { OrganizationPaymentRow } from "@/server/finance/organization-ledger";
import type { StockMaterialOption } from "@/server/warehouse/contracts";

type Line = { key: string; materialId: string; quantity: string; amount: string };
type Preview = Extract<Awaited<ReturnType<typeof previewExpenseReceipt>>, { ok: true }>;
const blankLine = (amount = ""): Line => ({ key: crypto.randomUUID(), materialId: "", quantity: "", amount });

export function ExpenseReceiptDialog({ payment, stockMaterials, onApplied }: {
  payment: OrganizationPaymentRow; stockMaterials: StockMaterialOption[]; onApplied: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [requestId, setRequestId] = useState("");
  const [pending, setPending] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const router = useRouter();
  if (!payment.canPostExpenseReceipt) return null;

  const begin = () => {
    setLines([blankLine(payment.amount.toFixed(2))]);
    setPreview(null);
    setUnconfirmed(false);
    setOpen(true);
  };
  const update = (key: string, values: Partial<Pick<Line, "materialId" | "quantity" | "amount">>) =>
    setLines(previous => previous.map(line => line.key === key ? { ...line, ...values } : line));
  const input = () => ({
    paymentId: payment.id, lines: lines.map(({ materialId, quantity, amount }) => ({ materialId, quantity, amount })),
  });

  async function check() {
    setPending(true);
    try {
      const result = await previewExpenseReceipt(input());
      if (!result.ok) return toast.error(result.error);
      setPreview(result);
      setRequestId(crypto.randomUUID());
    } catch {
      toast.error("Не удалось получить предпросмотр");
    } finally {
      setPending(false);
    }
  }

  async function apply() {
    if (!preview) return;
    setPending(true);
    try {
      const result = await applyExpenseReceipt({ ...input(), fingerprint: preview.fingerprint, clientMutationId: requestId }, preview.actorId);
      if (!result.ok) {
        setUnconfirmed(result.retry);
        if (!result.retry) setPreview(null);
        return toast.error(result.error);
      }
      toast.success("Материалы оприходованы");
      setOpen(false);
      router.refresh();
      onApplied();
    } catch {
      setUnconfirmed(true);
      toast.error("Не удалось подтвердить оприходование. Повторите тот же запрос.");
    } finally {
      setPending(false);
    }
  }

  return <>
    <Button variant="outline" onClick={begin}>Оприходовать на склад</Button>
    <Dialog open={open} onOpenChange={next => { if (!pending && !unconfirmed) setOpen(next); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Оприходовать на склад</DialogTitle>
          <DialogDescription>Распределите весь расход {formatAmount(payment.amount, payment.currency)} по материалам. Оплата уже проведена.</DialogDescription>
        </DialogHeader>
        {preview ? <div className="space-y-3 text-sm">
          {preview.projectNumber ? <p className="font-medium">Расход будет снят с проекта {preview.projectNumber}. Затраты на материал появятся у проекта при выдаче на изделие.</p> : null}
          <ul className="space-y-2">
            {preview.lines.map((line, index) => <li className="rounded-md border p-3" key={lines[index].key}>
              <b>{line.materialName}</b> · {formatQty(line.quantity)} {line.unit}<br/>
              {formatAmount(Number(line.amount), payment.currency)} · {formatAmount(Number(line.bynAmount), "BYN")}
            </li>)}
          </ul>
        </div> : <div className="space-y-3">
          {lines.map((line, index) => <fieldset className="space-y-3 rounded-md border p-3" key={line.key} disabled={pending}>
            <legend className="px-1 text-sm">Строка {index + 1}</legend>
            <StockMaterialPicker materials={stockMaterials} id={`expense-material-${line.key}`} value={line.materialId} onChange={materialId => update(line.key, { materialId })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label htmlFor={`expense-qty-${line.key}`}>Количество</Label>
                <Input id={`expense-qty-${line.key}`} inputMode="decimal" value={line.quantity} onChange={event => update(line.key, { quantity: event.target.value })}/></div>
              <div className="grid gap-1.5"><Label htmlFor={`expense-amount-${line.key}`}>Сумма, {payment.currency}</Label>
                <Input id={`expense-amount-${line.key}`} inputMode="decimal" value={line.amount} onChange={event => update(line.key, { amount: event.target.value })}/></div>
            </div>
            {lines.length > 1 ? <Button variant="ghost" onClick={() => setLines(previous => previous.filter(row => row.key !== line.key))}>Удалить строку</Button> : null}
          </fieldset>)}
          {lines.length < 50 ? <Button variant="outline" disabled={pending} onClick={() => setLines(previous => [...previous, blankLine()])}>Добавить материал</Button> : null}
        </div>}
        <DialogFooter>
          <Button variant="outline" disabled={pending || unconfirmed} onClick={() => preview ? setPreview(null) : setOpen(false)}>{preview ? "К строкам" : "Закрыть"}</Button>
          <Button disabled={pending || (!preview && lines.some(line => !line.materialId || !line.quantity.trim() || !line.amount.trim()))}
            onClick={preview ? apply : check}>{pending ? "Подождите…" : unconfirmed ? "Повторить подтверждение" : preview ? "Подтвердить оприходование" : "Предпросмотр"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
