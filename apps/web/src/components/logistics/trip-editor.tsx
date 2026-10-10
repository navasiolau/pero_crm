"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { formatExactMoney } from "@/lib/format";
import { createRequestId } from "@/lib/request-id";
import { createLogisticsTrip, updateLogisticsTrip } from "@/server/logistics/actions";
import { postLogisticsTrip, correctLogisticsTripPosting } from "@/server/logistics/money-actions";
import { logisticsTripCreateSchema, type LogisticsShipmentLineInput } from "@/server/logistics/contracts";
import { LogisticsDocuments } from "./documents";
import { LogisticsDocumentUpload } from "./document-upload";
import { normalizedMoney, percentBps, percentLabel, previewAllocations, shipmentToday } from "./model";
import type { ManagedTrip, MoneyOptions, TripOptions } from "./types";

type EditorProps = {
  trip: ManagedTrip | null; options: TripOptions; moneyOptions: MoneyOptions; projectId?: string;
  onSaved: (close: boolean) => void; onReload: () => void;
};
type DraftLine = { key: string; projectId: string; kind: "PRODUCT" | "MATERIAL"; entityId: string; quantity: string };
type Operation = "create" | "update" | "post" | "correct";
type PendingRequest = { operation: Operation; input: unknown };

export function LogisticsTripDialog(props: EditorProps & { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) props.onClose(); }}>
      <DialogContent className="sm:max-w-4xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{props.trip ? "Рейс " + props.trip.id.slice(0, 8) : "Новая отгрузка"}</DialogTitle>
          <DialogDescription>Один рейс для всех выбранных проектов. ТТН с одной печатью нужна для списания.</DialogDescription>
        </DialogHeader>
        <LogisticsTripForm {...props} onBusyChange={setBusy} />
      </DialogContent>
    </Dialog>
  );
}

export function LogisticsTripForm({ trip, options, moneyOptions, projectId, onSaved, onReload, onBusyChange }: EditorProps & { onBusyChange: (busy: boolean) => void }) {
  const [tripId, setTripId] = useState(trip?.id ?? ""), [revision, setRevision] = useState(trip?.revision ?? 1);
  const [date, setDate] = useState(trip?.date ?? shipmentToday()), [comment, setComment] = useState(trip?.comment ?? "");
  const [shares, setShares] = useState(trip?.shares.map(share => ({ projectId: share.projectId, percent: String(share.percentBps / 100) })) ?? (projectId ? [{ projectId, percent: "100" }] : []));
  const [lines, setLines] = useState<DraftLine[]>(trip?.lines.map(line => ({
    key: line.id, projectId: line.projectId, kind: line.kind, entityId: (line.kind === "PRODUCT" ? line.productId : line.materialId) ?? "", quantity: String(line.quantity),
  })) ?? []);
  const current = trip?.money.current;
  const [amount, setAmount] = useState(current?.amount ?? "");
  const [cashAccountId, setCashAccountId] = useState(current?.cashAccountId ?? moneyOptions.cashAccounts[0]?.id ?? "");
  const [documents, setDocuments] = useState(trip?.documents ?? []);
  const [loading, setLoading] = useState(false), [uploadBusy, setUploadBusy] = useState(false);
  const [error, setError] = useState(""), [conflict, setConflict] = useState(false), [uncertain, setUncertain] = useState(false);
  const lock = useRef(false), pending = useRef<PendingRequest | null>(null);
  const busy = loading || uploadBusy;
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  const disabled = busy || uncertain;
  const cash = moneyOptions.cashAccounts.find(account => account.id === cashAccountId);
  const bpsShares = shares.map(share => ({ projectId: share.projectId, percentBps: percentBps(share.percent) }));
  const totalBps = bpsShares.reduce((sum, share) => sum + share.percentBps, 0);
  const preview = previewAllocations(amount, bpsShares);
  const projectName = (id: string) => {
    const option = options.projects.find(project => project.id === id);
    const old = trip?.shares.find(share => share.projectId === id);
    return option ? option.number + " · " + option.title : old ? old.projectNumber + " · " + old.projectTitle : id;
  };
  const manifest = {
    date, comment, shares: bpsShares,
    lines: lines.map((line): LogisticsShipmentLineInput => line.kind === "PRODUCT"
      ? { projectId: line.projectId, kind: "PRODUCT", productId: line.entityId, quantity: Number(line.quantity.replace(",", ".")) }
      : { projectId: line.projectId, kind: "MATERIAL", materialId: line.entityId, quantity: Number(line.quantity.replace(",", ".")) }),
  };
  const validation = logisticsTripCreateSchema.safeParse({ ...manifest, clientMutationId: "00000000-0000-4000-8000-000000000001" });
  const canPost = validation.success && !!tripId && !!cash && !!normalizedMoney(amount) && documents.length > 0;
  const affectedIds = [...new Set([...shares.map(share => share.projectId), ...(current?.allocations.map(allocation => allocation.projectId) ?? [])])];

  function addProject(id: string) {
    if (!id || shares.some(share => share.projectId === id)) return;
    setShares(previous => [...previous, { projectId: id, percent: previous.length ? "" : "100" }]);
  }
  function removeProject(id: string) {
    setShares(previous => {
      const next = previous.filter(share => share.projectId !== id);
      return next.length === 1 ? [{ ...next[0], percent: "100" }] : next;
    });
    setLines(previous => previous.filter(line => line.projectId !== id));
  }
  function addLine(id: string, kind: "PRODUCT" | "MATERIAL") {
    setLines(previous => [...previous, { key: createRequestId(), projectId: id, kind, entityId: "", quantity: "1" }]);
  }
  function patchLine(key: string, patch: Partial<Pick<DraftLine, "entityId" | "quantity">>) {
    setLines(previous => previous.map(line => line.key === key ? { ...line, ...patch } : line));
  }
  function entityOptions(line: DraftLine) {
    const available = line.kind === "PRODUCT"
      ? (options.projects.find(project => project.id === line.projectId)?.products ?? []).map(product => ({ value: product.id, label: product.number + " · " + product.title, hint: "Всего экземпляров: " + product.quantity }))
      : options.materials.map(material => ({ value: material.id, label: material.name, hint: material.unit }));
    if (line.entityId && !available.some(option => option.value === line.entityId)) {
      const old = trip?.lines.find(candidate => candidate.id === line.key);
      available.push({ value: line.entityId, label: old?.nameSnapshot ?? line.entityId, hint: "Сохранённая позиция" });
    }
    return available;
  }

  async function save(operation: Operation) {
    if (lock.current || uploadBusy) return;
    if (!pending.current) {
      if (!validation.success) { setError(validation.error.issues[0]?.message ?? "Проверьте состав и доли"); return; }
      const clientMutationId = createRequestId();
      if (operation === "post" || operation === "correct") {
        const normalized = normalizedMoney(amount);
        if (!cash || !normalized || !canPost) { setError("Укажите кассу, сумму, доли 100% и загрузите ТТН с печатью"); return; }
        pending.current = { operation, input: { tripId, expectedRevision: revision, clientMutationId,
          amount: normalized, currency: cash.currency, cashAccountId: cash.id, documentIds: documents.map(document => document.id), manifest } };
      } else {
        pending.current = { operation, input: { ...manifest, clientMutationId,
          ...(operation === "update" ? { tripId, expectedRevision: revision } : {}) } };
      }
    }
    const request = pending.current;
    lock.current = true; setLoading(true); setError(""); setConflict(false);
    try {
      const result = request.operation === "create" ? await createLogisticsTrip(request.input)
        : request.operation === "update" ? await updateLogisticsTrip(request.input)
        : request.operation === "post" ? await postLogisticsTrip(request.input as Parameters<typeof postLogisticsTrip>[0])
        : await correctLogisticsTripPosting(request.input as Parameters<typeof correctLogisticsTripPosting>[0]);
      if (!result.ok) {
        setError(result.error); setConflict(result.code.includes("CONFLICT") || result.code.includes("REVISION"));
        pending.current = null; setUncertain(false); return;
      }
      setTripId(result.tripId); setRevision(result.revision); setUncertain(false); pending.current = null;
      onSaved(request.operation === "post" || request.operation === "correct");
    } catch {
      // Результат мог сохраниться: повторяем тот же payload и mutation ID.
      setUncertain(true); setError("Ответ не получен. Данные сохранены в форме; повторите подтверждение того же запроса.");
    } finally { lock.current = false; setLoading(false); }
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">Дата отгрузки<Input type="date" value={date} disabled={disabled} onChange={event => setDate(event.target.value)} /></label>
        <label className="space-y-1 text-sm">Комментарий<Input value={comment} maxLength={5000} disabled={disabled} onChange={event => setComment(event.target.value)} /></label>
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold">Проекты и состав отгрузки</h3>
        <SearchableSelect value="" disabled={disabled} placeholder="Добавить проект…" searchPlaceholder="Номер или название проекта…"
          options={options.projects.filter(project => !shares.some(share => share.projectId === project.id)).map(project => ({ value: project.id, label: project.number + " · " + project.title }))}
          onChange={addProject} />
        {shares.map(share => (
          <div key={share.projectId} className="min-w-0 space-y-3 rounded-xl border p-3">
            <div className="flex flex-wrap items-center gap-3">
              <h4 className="min-w-0 flex-1 break-words font-medium">{projectName(share.projectId)}</h4>
              <label className="flex items-center gap-2 text-sm">Доля, %
                <Input className="w-24" inputMode="decimal" value={share.percent} disabled={disabled}
                  onChange={event => setShares(previous => previous.map(item => item.projectId === share.projectId ? { ...item, percent: event.target.value } : item))} />
              </label>
              <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={"Убрать проект " + projectName(share.projectId)} onClick={() => removeProject(share.projectId)}><Trash2 className="size-4" /></Button>
            </div>
            {lines.filter(line => line.projectId === share.projectId).map(line => (
              <div key={line.key} className="grid min-w-0 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
                <label className="min-w-0 space-y-1 text-sm">{line.kind === "PRODUCT" ? "Изделие" : "Материал"}
                  <SearchableSelect value={line.entityId} disabled={disabled} options={entityOptions(line)} placeholder="Выберите позицию…" onChange={value => patchLine(line.key, { entityId: value })} />
                </label>
                <label className="space-y-1 text-sm">Количество<Input inputMode={line.kind === "PRODUCT" ? "numeric" : "decimal"} value={line.quantity} disabled={disabled} onChange={event => patchLine(line.key, { quantity: event.target.value })} /></label>
                <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label="Убрать позицию отгрузки" onClick={() => setLines(previous => previous.filter(item => item.key !== line.key))}><Trash2 className="size-4" /></Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => addLine(share.projectId, "PRODUCT")}><Plus className="size-4" />Изделие</Button>
              <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => addLine(share.projectId, "MATERIAL")}><Plus className="size-4" />Материал</Button>
            </div>
          </div>
        ))}
        <p className={"text-sm " + (totalBps === 10000 ? "text-muted-foreground" : "text-destructive")}>
          Сумма долей: {percentLabel(totalBps)}. {totalBps === 10000 ? "Распределено 100%." : "Нужно распределить ровно 100%."}
        </p>
        {!current && <Button type="button" variant="outline" disabled={disabled || !validation.success} onClick={() => void save(tripId ? "update" : "create")}>
          {tripId ? "Сохранить состав рейса" : "Сохранить рейс и перейти к ТТН"}
        </Button>}
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold">ТТН</h3>
        <LogisticsDocuments documents={documents} />
        {tripId ? <LogisticsDocumentUpload tripId={tripId} disabled={loading || uncertain}
          defaultStage={documents.length ? "SIGNED" : "ISSUED"} onBusyChange={value => { setUploadBusy(value); if (!value) onSaved(false); }}
          onUploaded={document => {
            setDocuments(previous => previous.some(item => item.id === document.id) ? previous : [...previous, document]);
          }} /> : <p className="text-sm text-muted-foreground">Сначала сохраните рейс, затем добавьте ТТН с одной печатью.</p>}
        {current && <p className="text-sm text-muted-foreground">ТТН со второй печатью добавляется к этому рейсу без повторного списания.</p>}
      </div>

      <div className="space-y-3">
        <h3 className="font-semibold">Общие затраты на рейс</h3>
        {current && <p className="text-sm">Сейчас списано: <strong>{formatExactMoney(current.amount, current.currency)}</strong> · {current.cashAccountName}. Сохранённый итог: {formatExactMoney(current.bynAmount, "BYN")}.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="min-w-0 space-y-1 text-sm">Касса
            <SearchableSelect value={cashAccountId} disabled={disabled} placeholder="Выберите кассу…"
              options={moneyOptions.cashAccounts.map(account => ({ value: account.id, label: account.name + " · " + account.currency, hint: "Баланс: " + account.balance + " " + account.currency }))} onChange={setCashAccountId} />
          </label>
          <label className="space-y-1 text-sm">Общая сумма, {cash?.currency ?? "валюта кассы"}<Input inputMode="decimal" value={amount} disabled={disabled} onChange={event => setAmount(event.target.value)} /></label>
        </div>
        <p className="text-xs text-muted-foreground">Одна общая сумма. Затраты распределяются по долям проектов.</p>
        {preview.size > 0 && cash && (
          <div className="space-y-2 rounded-lg bg-muted/30 p-3 text-sm">
            <p className="font-medium">Распределение в валюте кассы</p>
            {affectedIds.map(id => {
              const old = current?.allocations.find(allocation => allocation.projectId === id);
              return <p key={id} className="break-words">{projectName(id)}: {percentLabel(bpsShares.find(share => share.projectId === id)?.percentBps ?? 0)} · {formatExactMoney(preview.get(id) ?? "0.00", cash.currency)}
                {old && current && <span className="text-muted-foreground"> · ранее {formatExactMoney(old.amount, current.currency)}</span>}
              </p>;
            })}
            <p className="text-xs text-muted-foreground">Для валютной кассы точные расходы проектов в BYN фиксируются сервером при списании.</p>
          </div>
        )}
        <Button type="button" disabled={disabled || !canPost} onClick={() => void save(current ? "correct" : "post")}>
          {loading ? "Сохранение…" : current ? "Исправить списание и состав рейса" : "Списать из кассы"}
        </Button>
        {!documents.length && <p className="text-xs text-muted-foreground">Для списания нужна сохранённая ТТН с одной или двумя печатями.</p>}
      </div>

      {trip && trip.money.history.length > 0 && (
        <details className="space-y-2 text-sm">
          <summary className="cursor-pointer font-medium">История исправлений списания</summary>
          {trip.money.history.map(posting => <p key={posting.id}>{posting.paidAt} · {formatExactMoney(posting.amount, posting.currency)} · {posting.cashAccountName} · {posting.createdByName}</p>)}
        </details>
      )}
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      {conflict && <Button type="button" variant="outline" disabled={busy} onClick={onReload}>Открыть актуальную запись</Button>}
      {uncertain && pending.current && <Button type="button" variant="outline" disabled={busy} onClick={() => void save(pending.current!.operation)}>Повторить подтверждение</Button>}
    </div>
  );
}
