"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { QuantityStepper } from "@/components/quantity-stepper";
import { formatAmount } from "@/lib/format";
import { quantityFromAtoms } from "@/lib/work-shares";
import { scaleNorm, workBudget } from "@/lib/product-quantity";
import { isPositiveQuantity, quantityInputError } from "@/lib/work-quantity";
import { addWork, updateWork } from "@/server/works/actions";
import type { AddWorkInput } from "@/server/works/core";
import type { UpdateWorkInput } from "@/server/works/update-core";
import type { WorkOperation } from "@/server/works/queries";

type EditableWork = { id: string; title: string; quantity: string; quantityPerUnit?: string | null;
  unitSnapshot?: string | null; priceSnapshot: string | null; operation?: WorkOperation };
type PriceOption = { id: string; name: string; unit: string; price: string };
type Request = { mode: "create"; data: AddWorkInput } | { mode: "edit"; data: UpdateWorkInput };

export function WorkDialog({ open, onClose, projectId, productId, productQuantity = 1, priceItems, work }: {
  open: boolean; onClose: () => void; projectId: string; productId?: string; productQuantity?: number;
  priceItems: PriceOption[]; work?: EditableWork;
}) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const [priceItemId, setPriceItemId] = useState(work?.operation?.priceItemId ?? "");
  const [quantity, setQuantity] = useState(work ? work.quantityPerUnit ?? (productQuantity === 1 ? work.quantity : "") : "1");
  const [error, setError] = useState<string | null>(null), [uncertain, setUncertain] = useState(false);
  const request = useRef<Request | null>(null), submitting = useRef(false);
  const locked = pending || uncertain, quantityError = quantityInputError(quantity);
  const mayChoosePrice = !work || work.operation?.canChangePrice;
  const selected = priceItems.find(item => item.id === priceItemId);
  const options = priceItems.map(item => ({ value: item.id, label: item.name, hint: `${formatAmount(item.price, "BYN")} / ${item.unit}` }));
  if (work && priceItemId && !options.some(option => option.value === priceItemId)) options.unshift({ value: priceItemId, label: work.title, hint: "Сохранённая расценка" });
  const previewPrice = work && priceItemId === work.operation?.priceItemId ? work.priceSnapshot : selected?.price;
  const count = productId ? productQuantity : 1;
  const validCount = Number.isInteger(count) && count > 0;
  const limit = validCount ? quantityFromAtoms(BigInt("9999999999") / BigInt(count)) : "0.00";
  let planned: string | null = null, previewTotal: string | null = null;
  try {
    if (validCount && !quantityError && isPositiveQuantity(quantity)) {
      planned = scaleNorm(quantity, count, 2, 10);
      if (previewPrice != null) previewTotal = workBudget(previewPrice, planned);
    }
  } catch { /* Невалидный объём не становится приблизительным нулём. */ }
  const valid = planned !== null && (!mayChoosePrice || Boolean(priceItemId));

  function submit() {
    if (submitting.current) return;
    const payload: Request = request.current ?? (work && productId ? { mode: "edit", data: {
      projectId, productId, workId: work.id, quantityPerUnit: Number(quantity), expectedRevision: work.operation!.revision,
      ...(mayChoosePrice ? { priceItemId } : {}), clientMutationId: crypto.randomUUID(),
    } } : { mode: "create", data: { projectId, productId, priceItemId,
      ...(productId ? { quantityPerUnit: Number(quantity) } : { quantity: Number(quantity) }), clientMutationId: crypto.randomUUID() } });
    request.current = payload; submitting.current = true; setError(null);
    startTransition(async () => {
      try {
        const result = payload.mode === "edit" ? await updateWork(payload.data) : await addWork(payload.data);
        if (result.ok) { request.current = null; setUncertain(false); toast.success(work ? "Работа обновлена" : "Работа добавлена"); onClose(); router.refresh(); }
        else {
          setError(result.error ?? "Не удалось сохранить работу");
          if ("kind" in result && result.kind === "failure") setUncertain(true);
          else { request.current = null; setUncertain(false); }
        }
      } catch { setUncertain(true); setError("Ответ не получен. Повторите тот же запрос, чтобы подтвердить результат."); }
      finally { submitting.current = false; }
    });
  }

  return <Dialog open={open} onOpenChange={value => { if (!value && !locked) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>{work ? "Редактировать работу" : "Новая работа"}</DialogTitle></DialogHeader>
    <fieldset disabled={locked} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1.5"><Label>Расценка из прайса *</Label>
        {mayChoosePrice ? <SearchableSelect options={options} value={priceItemId} onChange={setPriceItemId} disabled={locked}
          placeholder="Выберите расценку…" searchPlaceholder="Поиск расценки…" popupMinWidth={560} wrapOptions /> : <p className="text-sm">{work?.title} · расценка сохранена</p>}
        {priceItems.length === 0 && !work ? <p className="text-sm text-muted-foreground">Прайс пуст — обратитесь к менеджеру.</p> : null}
      </div>
      <div className="flex flex-col gap-1.5"><Label htmlFor="work-qty">{productId ? "Количество на 1 изделие *" : "Количество *"}</Label>
        <QuantityStepper id="work-qty" context="plan" value={quantity} onChange={setQuantity} remaining={limit} unit={work?.unitSnapshot ?? selected?.unit ?? "шт"} />
      </div>
      {planned !== null ? <p className="text-sm text-muted-foreground">
        {productId ? `${quantity} × ${productQuantity} = ${planned}` : `Количество: ${quantity}`}
        {previewTotal != null ? ` · итого ${formatAmount(previewTotal, "BYN")}` : ""}
      </p> : null}
      {work ? <p className="text-sm text-muted-foreground">Уже распределено: {work.operation?.allocated}. Существующие задачи сохраняются.</p> : null}
    </fieldset>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <DialogFooter><Button variant="outline" disabled={locked} onClick={onClose}>Отмена</Button>
      <Button disabled={pending || (!uncertain && !valid)} onClick={submit}>{uncertain ? "Повторить тот же запрос" : pending ? "Сохраняем…" : work ? "Сохранить" : "Добавить"}</Button>
    </DialogFooter>
  </DialogContent></Dialog>;
}
