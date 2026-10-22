"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { QuantityStepper } from "@/components/quantity-stepper";
import { formatAmount } from "@/lib/format";
import { allocatePiecework, quantityAtoms, splitAllocation, taskPieceAmount } from "@/lib/work-shares";
import { createPieceworkAllocation, getPieceworkOptions, transferPieceworkShare } from "@/server/tasks/piecework-actions";
import type { CreatePieceworkInput, TransferPieceworkInput } from "@/server/tasks/piecework-core";
import type { PieceworkOptions } from "@/server/tasks/piecework-queries";

export type PieceworkContext = { productId: string } & (
  { mode: "create"; projectId: string; work: { id: string; title: string; unit: string } } |
  { mode: "transfer"; taskId: string; title: string }
);
type PinnedRequest = { mode: "create"; input: CreatePieceworkInput } | { mode: "transfer"; input: TransferPieceworkInput };
const percentDraftUnits = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
};

export function PieceworkButton({ context, label, onDone, disabled = false }: { context: PieceworkContext; label: string; onDone?: () => void; disabled?: boolean }) {
  const [options, setOptions] = useState<PieceworkOptions | null>(null), [loading, startLoading] = useTransition();
  return <><Button variant="outline" size="sm" disabled={disabled || loading} onClick={event => {
    event.stopPropagation();
    startLoading(async () => {
      try {
        const data = await getPieceworkOptions(context.productId, context.mode === "transfer" ? context.taskId : undefined);
        if (!data || (context.mode === "create" ? !data.canCreate || !data.works.some(work => work.id === context.work.id) : !data.transferable)) { toast.error("Распределение недоступно. Обновите карточку"); return; }
        setOptions(data);
      } catch { toast.error("Не удалось загрузить исполнителей"); }
    });
  }}>{label}</Button>{options ? <PieceworkAllocationDialog context={context} options={options} onClose={() => setOptions(null)} onDone={onDone}/> : null}</>;
}

export function PieceworkAllocationDialog({ context, options, onClose, onDone }: { context: PieceworkContext; options: PieceworkOptions; onClose: () => void; onDone?: () => void }) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const selectedWork = context.mode === "create" ? options.works.find(work => work.id === context.work.id) : undefined;
  const remaining = selectedWork?.remaining ?? "0";
  const [participants, setParticipants] = useState([{ userId: "", percent: "50" }, { userId: "", percent: "50" }]);
  const [recipientId, setRecipientId] = useState(""), [percent, setPercent] = useState("30");
  const [quantity, setQuantity] = useState(remaining), [requiresPhoto, setRequiresPhoto] = useState(false);
  const [percentageHint, setPercentageHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null), [uncertain, setUncertain] = useState(false);
  const request = useRef<PinnedRequest | null>(null), submitting = useRef(false);
  const locked = pending || uncertain;
  const effectiveQuantity = quantity.trim() || remaining;
  let preview: { amount: string; allocations: ReturnType<typeof allocatePiecework> } | null = null;
  let transferred: ReturnType<typeof splitAllocation> | null = null;
  let validation: string | null = null;
  try {
    if (context.mode === "create") {
      if (quantityAtoms(effectiveQuantity) <= BigInt(0) || quantityAtoms(effectiveQuantity) > quantityAtoms(remaining)) throw Error("Проверьте объём работы");
      if (!selectedWork) throw Error("Работа недоступна");
      const amount = taskPieceAmount({ quantity: effectiveQuantity, executorShare: "1" }, selectedWork.priceSnapshot);
      preview = { amount, allocations: allocatePiecework(amount, participants.map(row => row.percent)) };
      if (participants.some(row => !row.userId) || new Set(participants.map(row => row.userId)).size !== participants.length) throw Error("Выберите разных исполнителей");
    } else {
      if (!options.source) throw Error("Доля недоступна");
      transferred = splitAllocation(options.source.shareUnits, options.source.amount, percent);
      if (!recipientId) throw Error("Выберите получателя");
    }
  } catch (cause) { validation = cause instanceof Error ? cause.message : "Проверьте проценты"; }
  const valid = !validation;

  function changeParticipantPercent(index: number, value: string) {
    const normalized = value.replace(",", ".");
    if (!/^[0-9]{0,3}(?:\.[0-9]{0,2})?$/.test(normalized)) {
      setPercentageHint("Введите только цифры, не более двух знаков после запятой");
      return;
    }
    const total = participants.reduce((sum, row, i) => sum + percentDraftUnits(i === index ? normalized : row.percent), 0);
    if (total > 10000) { setPercentageHint("Сумма процентов не может превышать 100%"); return; }
    setPercentageHint(null);
    setParticipants(rows => rows.map((row, i) => i === index ? { ...row, percent: normalized } : row));
  }

  function submit() {
    if (pending || submitting.current || !request.current && !valid) return;
    if (!request.current) {
      const clientMutationId = crypto.randomUUID();
      request.current = context.mode === "create" ? { mode: "create", input: Object.freeze({ projectId: context.projectId, productId: context.productId,
        workId: context.work.id, title: context.work.title, quantity: effectiveQuantity, type: "Производство", requiresPhoto,
        participants: Object.freeze(participants.map(row => Object.freeze({ ...row }))) as typeof participants, expectedRevision: selectedWork!.revision, clientMutationId }) } : { mode: "transfer", input: Object.freeze({ taskId: context.taskId, recipientId, percent, expectedRevision: options.source!.revision, clientMutationId }) };
    }
    const pinned = request.current;
    submitting.current = true; setError(null);
    startTransition(async () => {
      try {
        const result = pinned.mode === "create" ? await createPieceworkAllocation(pinned.input) : await transferPieceworkShare(pinned.input);
        if (result.ok) { request.current = null; setUncertain(false); toast.success(context.mode === "create" ? "Работа распределена" : "Часть доли передана"); onDone?.(); onClose(); router.refresh(); return; }
        setError(result.error);
        if (result.kind === "failure") setUncertain(true);
        else { request.current = null; setUncertain(false); }
      } catch { setUncertain(true); setError("Ответ не получен. Повторите тот же запрос, чтобы проверить результат."); }
      finally { submitting.current = false; }
    });
  }
  return <Dialog open onOpenChange={open => { if (!open && !locked) onClose(); }}><DialogContent className="sm:max-w-3xl"><DialogHeader><DialogTitle>{context.mode === "create" ? "Распределить работу в процентах" : "Передать часть доли"}</DialogTitle><DialogDescription>{context.mode === "create" ? context.work.title : context.title}. Начисление происходит после выполнения задачи каждого исполнителя.</DialogDescription></DialogHeader>
    <fieldset disabled={locked} className="flex min-w-0 flex-col gap-4">
      {context.mode === "create" ? <>
        <div className="flex flex-col gap-1.5"><Label>Общий объём работы</Label><QuantityStepper value={quantity} onChange={setQuantity} remaining={remaining} unit={context.work.unit}/><p className="text-xs text-muted-foreground">Объём учитывается один раз для всех участников.</p></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={requiresPhoto} onChange={event => setRequiresPhoto(event.target.checked)}/>Фото при выполнении</label>
        <p className="text-sm">Бюджет: {preview ? formatAmount(preview.amount, "BYN") : "—"}</p>
        {participants.map((row, index) => <div key={index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_6rem] items-end gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_6rem_7rem_auto]"><div className="min-w-0"><Label htmlFor={`piecework-user-${index}`}>Исполнитель {index + 1}</Label><SearchableSelect id={`piecework-user-${index}`} value={row.userId} disabled={locked} onChange={userId => setParticipants(rows => rows.map((item, i) => i === index ? { ...item, userId } : item))} options={options.recipients.filter(user => user.id === row.userId || !participants.some(item => item.userId === user.id)).map(user => ({ value: user.id, label: user.name }))} placeholder="Исполнитель" searchPlaceholder="Поиск сотрудника…"/></div><div><Label htmlFor={`piecework-percent-${index}`}>Процент</Label><Input id={`piecework-percent-${index}`} inputMode="decimal" value={row.percent} aria-describedby={percentageHint ? "piecework-percent-hint" : undefined} onChange={event => changeParticipantPercent(index, event.target.value)}/></div><span className="pb-2 text-sm">{preview ? formatAmount(preview.allocations[index].shareAmount, "BYN") : "—"}</span><Button variant="ghost" disabled={locked || participants.length === 1} onClick={() => { setParticipants(rows => rows.filter((_, i) => i !== index)); setPercentageHint(null); }} aria-label={`Убрать исполнителя ${index + 1}`}>Убрать</Button></div>)}
        <Button variant="outline" disabled={locked} onClick={() => { setParticipants(rows => [...rows, { userId: "", percent: "" }]); setPercentageHint(null); }}>Добавить исполнителя</Button>
        {percentageHint ? <p id="piecework-percent-hint" role="alert" className="text-sm text-destructive">{percentageHint}</p> : null}
        {participants.length > options.recipients.length ? <p className="text-sm text-muted-foreground">Нет свободного подходящего сотрудника со сдельной оплатой. Уберите лишнюю строку или обновите список.</p> : null}
      </> : <>
        <p className="text-sm">Текущая доля задачи: {options.source ? formatAmount(options.source.amount, options.source.currency) : "—"}</p>
        <div className="flex flex-col gap-1.5"><Label>Получатель</Label><SearchableSelect value={recipientId} disabled={locked} onChange={setRecipientId} options={options.recipients.map(user => ({ value: user.id, label: user.name }))} placeholder="Выберите сотрудника" searchPlaceholder="Поиск сотрудника…"/></div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="piecework-transfer-percent">Процент от текущей доли задачи</Label><Input id="piecework-transfer-percent" inputMode="decimal" value={percent} onChange={event => setPercent(event.target.value.replace(",", "."))}/></div>
        {transferred ? <p className="text-sm">Передаётся {formatAmount(transferred.transferredAmount, "BYN")}; остаётся {formatAmount(transferred.remainingAmount, "BYN")}.</p> : null}
      </>}
    </fieldset>
    {validation && !error ? <p className="text-sm text-muted-foreground">{validation}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {uncertain ? <p role="note" className="text-sm text-muted-foreground">Поля зафиксированы до подтверждения. Повтор отправит прежний запрос с тем же идентификатором.</p> : null}
    <DialogFooter><Button variant="outline" disabled={locked} onClick={onClose}>Отмена</Button><Button disabled={pending || !uncertain && !valid} onClick={submit}>{uncertain ? "Повторить тот же запрос" : context.mode === "create" ? "Распределить" : "Передать"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
