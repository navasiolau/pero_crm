"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createRequestId } from "@/lib/request-id";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCompositionDraft, saveCompositionItem, deleteCompositionItem, discardCompositionDraft,
  confirmCompositionDraft } from "@/server/composition/actions";
import { CompositionView, type CompositionData, type CompositionItem } from "./composition-view";
import { compositionParentOptions, nextCompositionConfirmRequestId, parseCompositionQuantity } from "./composition-form";

type FormKind = "MODULE" | "PART" | "HARDWARE";
type FormState = { itemId: string | null; kind: FormKind; designation: string; title: string; quantity: string;
  parentId: string; travelsToInstallation: boolean; sortOrder: number };
const freshForm = (order: number): FormState => ({ itemId: null, kind: "PART", designation: "", title: "", quantity: "1",
  parentId: "", travelsToInstallation: false, sortOrder: order });

export function CompositionTab({ data, canEdit, authorNames = {} }: { data: CompositionData; canEdit: boolean; authorNames?: Record<string, string> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CompositionItem | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmRequestId = useRef<string | null>(null);
  const selected = data.selected;
  const editingDraft = canEdit && selected?.status === "DRAFT";

  function showRevision(revisionId: string | null) {
    const url = new URL(window.location.href);
    if (revisionId) url.searchParams.set("compositionRevision", revisionId);
    else url.searchParams.delete("compositionRevision");
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
    router.refresh();
  }
  function failAction(message: string, code?: string) {
    setError(message);
    toast.error(message);
    if (code === "DRAFT_VERSION_CHANGED" || code === "DRAFT_NOT_FOUND") router.refresh();
  }
  function beginForm(item?: CompositionItem) {
    setFormError(null);
    setForm(item ? { itemId: item.id, kind: item.kind, designation: item.designation, title: item.title,
      quantity: String(item.quantityPerParent), parentId: item.parentId ?? "", travelsToInstallation: item.travelsToInstallation,
      sortOrder: item.sortOrder } : freshForm(data.items.length));
  }
  function createDraft() {
    startTransition(async () => {
      try {
        const result = await createCompositionDraft(data.productId);
        if (!result.ok) return failAction(result.message, result.error);
        setError(null);
        showRevision(result.result.id);
      } catch { failAction("Неизвестен результат создания черновика. Обновите карточку перед повтором."); }
    });
  }
  function saveForm() {
    if (!form || !selected || selected.status !== "DRAFT") return;
    const quantity = parseCompositionQuantity(form.quantity);
    if (quantity === null) {
      setFormError("Количество должно быть целым от 1 до 1 000 000."); return;
    }
    startTransition(async () => {
      try {
        const result = await saveCompositionItem({ productId: data.productId, revisionId: selected.id,
          expectedDraftVersion: selected.draftVersion, ...(form.itemId ? { itemId: form.itemId } : {}), kind: form.kind,
          designation: form.designation, title: form.title, quantityPerParent: quantity,
          parentId: form.parentId || null, travelsToInstallation: form.travelsToInstallation, sortOrder: form.sortOrder });
        if (!result.ok) { setFormError(result.message); if (result.error === "DRAFT_VERSION_CHANGED") router.refresh(); return; }
        setForm(null); setError(null); router.refresh();
      } catch { setFormError("Неизвестен результат сохранения. Обновите карточку перед повтором."); }
    });
  }
  async function removeItem() {
    if (!deleting || !selected || selected.status !== "DRAFT") return false;
    try {
      const result = await deleteCompositionItem({ productId: data.productId, revisionId: selected.id,
        expectedDraftVersion: selected.draftVersion, itemId: deleting.id });
      if (!result.ok) { failAction(result.message, result.error); return false; }
      setDeleting(null); setError(null); router.refresh(); return true;
    } catch { failAction("Неизвестен результат удаления. Обновите карточку перед повтором."); return false; }
  }
  async function discard() {
    const draft = data.draft;
    if (!draft) return false;
    try {
      const result = await discardCompositionDraft({ productId: data.productId, revisionId: draft.id,
        expectedDraftVersion: draft.draftVersion });
      if (!result.ok) { failAction(result.message, result.error); return false; }
      setDiscardOpen(false); setError(null); showRevision(data.current?.id ?? null); return true;
    } catch { failAction("Неизвестен результат отмены. Обновите карточку перед повтором."); return false; }
  }
  function confirm() {
    if (!selected || selected.status !== "DRAFT") return;
    try { confirmRequestId.current = nextCompositionConfirmRequestId(confirmRequestId.current, createRequestId); }
    catch { setError("Безопасный идентификатор запроса недоступен."); return; }
    startTransition(async () => {
      try {
        const result = await confirmCompositionDraft({ productId: data.productId, revisionId: selected.id,
          expectedDraftVersion: selected.draftVersion, requestId: confirmRequestId.current! });
        if (!result.ok) { confirmRequestId.current = null; return failAction(result.message, result.error); }
        confirmRequestId.current = null;
        setConfirmOpen(false); setError(null); showRevision(result.result.id);
      } catch { failAction("Результат подтверждения неизвестен. Повторите в этом окне: будет использован тот же запрос."); }
    });
  }

  return <div className="min-w-0 space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        <Label htmlFor="composition-revision">Ревизия состава</Label>
        <select id="composition-revision" className="border-input bg-background min-h-12 w-full min-w-0 rounded-md border px-3 text-base sm:w-72"
          value={selected?.id ?? "none"} onChange={(event) => showRevision(event.target.value === "none" ? null : event.target.value)}>
          {!selected ? <option value="none">Состав не задан</option> : null}
          {data.current ? <option value={data.current.id}>Текущая · ревизия {data.current.revisionNo}</option> : null}
          {data.draft ? <option value={data.draft.id}>Черновик, не подтверждён</option> : null}
          {data.history.filter((revision) => revision.id !== data.current?.id).map((revision) =>
            <option key={revision.id} value={revision.id}>Ревизия {revision.revisionNo} · история</option>)}
        </select>
      </div>
      {canEdit ? <div className="flex flex-wrap gap-2">
        {!data.draft ? <Button type="button" className="min-h-12" disabled={pending} onClick={createDraft}>
          {data.current ? "Создать новую ревизию" : "Создать черновик"}
        </Button> : selected?.id !== data.draft.id ? <Button type="button" variant="outline" className="min-h-12"
          onClick={() => showRevision(data.draft!.id)}>Продолжить черновик</Button> : null}
        {editingDraft ? <>
          <Button type="button" className="min-h-12" onClick={() => beginForm()} disabled={pending}>Добавить позицию</Button>
          <Button type="button" variant="outline" className="min-h-12" onClick={() => setConfirmOpen(true)} disabled={pending || !data.items.length}>
            Подтвердить ревизию
          </Button>
          <Button type="button" variant="outline" className="min-h-12" onClick={() => setDiscardOpen(true)} disabled={pending}>Отменить черновик</Button>
        </> : null}
      </div> : null}
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {data.draft && selected?.status === "CONFIRMED" ? <p className="text-sm text-muted-foreground">
      Подтверждённая ревизия остаётся текущей. Черновик доступен отдельно и ещё не подтверждён.
    </p> : null}
    <CompositionView data={data} canEdit={editingDraft} authorNames={authorNames} onEdit={beginForm} onDelete={setDeleting} />

    <Dialog open={form !== null} onOpenChange={(open) => { if (!open) { setForm(null); setFormError(null); } }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>{form?.itemId ? "Изменить позицию" : "Новая позиция"}</DialogTitle>
          <DialogDescription>Количество задаётся на один экземпляр непосредственного родителя.</DialogDescription></DialogHeader>
        {form ? <div className="space-y-4">
          <div className="space-y-1"><Label htmlFor="composition-kind">Тип</Label>
            <select id="composition-kind" className="border-input bg-background min-h-12 w-full rounded-md border px-3 text-base"
              value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as FormKind })}>
              <option value="MODULE">Модуль</option><option value="PART">Деталь</option><option value="HARDWARE">Фурнитура</option>
            </select></div>
          <div className="space-y-1"><Label htmlFor="composition-parent">Родительский модуль</Label>
            <select id="composition-parent" className="border-input bg-background min-h-12 w-full rounded-md border px-3 text-base"
              value={form.parentId} onChange={(event) => setForm({ ...form, parentId: event.target.value })}>
              <option value="">На изделии, без родителя</option>
              {compositionParentOptions(data.items, form.itemId).map((item) => <option key={item.id} value={item.id}>{item.designation} · {item.title}</option>)}
            </select></div>
          <div className="space-y-1"><Label htmlFor="composition-designation">Обозначение</Label>
            <Input id="composition-designation" className="min-h-12 text-base" value={form.designation}
              onChange={(event) => setForm({ ...form, designation: event.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="composition-title">Название</Label>
            <Input id="composition-title" className="min-h-12 text-base" value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="composition-quantity">Количество на родителя, шт.</Label>
            <Input id="composition-quantity" type="number" min={1} max={1000000} step={1} inputMode="numeric"
              className="min-h-12 text-base" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></div>
          <div className="flex min-h-11 items-center gap-3"><Checkbox id="composition-installation" checked={form.travelsToInstallation}
            onCheckedChange={(checked) => setForm({ ...form, travelsToInstallation: checked === true })} />
            <Label htmlFor="composition-installation">Поедет на монтаж</Label></div>
          {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
        </div> : null}
        <DialogFooter><Button type="button" variant="outline" className="min-h-12" onClick={() => setForm(null)}>Отмена</Button>
          <Button type="button" className="min-h-12" disabled={pending} onClick={saveForm}>{pending ? "Сохранение…" : "Сохранить"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <ConfirmDeleteDialog entityLabel={deleting ? `позицию «${deleting.designation}»` : "позицию"} open={deleting !== null}
      onOpenChange={(open) => { if (!open) setDeleting(null); }} onConfirm={removeItem}
      warning={deleting?.kind === "MODULE" && data.items.some((item) => item.parentId === deleting.id)
        ? "Вложенные позиции этого модуля тоже будут удалены из черновика." : undefined} />
    <ConfirmDeleteDialog entityLabel="черновик состава" open={discardOpen} onOpenChange={setDiscardOpen} onConfirm={discard}
      warning="Подтверждённые ревизии сохранятся без изменений." />
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto"><DialogHeader>
        <DialogTitle>Подтвердить ревизию состава?</DialogTitle>
        <DialogDescription>После подтверждения строки станут неизменяемыми. Для новых правок создайте следующий черновик.</DialogDescription>
      </DialogHeader>
        <div className="flex flex-wrap gap-2"><Badge variant="secondary">{data.items.length} позиций</Badge>
          <Badge variant="outline">Черновик, не подтверждён</Badge></div>
        <DialogFooter><Button type="button" variant="outline" className="min-h-12" onClick={() => setConfirmOpen(false)}>Отмена</Button>
          <Button type="button" className="min-h-12" disabled={pending} onClick={confirm}>{pending ? "Подтверждение…" : "Подтвердить"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
