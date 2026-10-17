"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createCounterparty, updateCounterparty } from "@/server/counterparties/actions";
import { counterpartyTypes, counterpartyTypeLabels, type CounterpartyInput, type CounterpartyView } from "@/server/counterparties/contracts";

const emptyForm = { type: "SUPPLIER" as CounterpartyInput["type"], company: "", phone: "", comment: "" };

export function CounterpartyDialog({ open, onOpenChange, editing, onSaved }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: CounterpartyView | null;
  onSaved: (item: CounterpartyView) => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!open) return;
    setForm(editing ? { type: editing.type, company: editing.company, phone: editing.phone ?? "", comment: editing.comment ?? "" } : emptyForm);
    setError(null);
  }, [open, editing]);

  function submit() {
    if (pending || !form.company.trim()) return;
    startTransition(async () => {
      setError(null);
      const input: CounterpartyInput = { type: form.type, company: form.company.trim(), phone: form.phone.trim() || undefined, comment: form.comment.trim() || undefined };
      try {
        const result = editing ? await updateCounterparty(editing.id, input, editing.revision) : await createCounterparty(input);
        if (!result.ok) { setError(result.error); return; }
        onSaved(result.item);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Не удалось сохранить контрагента");
      }
    });
  }

  return <Dialog open={open} onOpenChange={value => { if (!pending) onOpenChange(value); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{editing ? "Редактировать контрагента" : "Новый контрагент"}</DialogTitle>
        <DialogDescription>Контакты поставщика или перевозчика.</DialogDescription>
      </DialogHeader>
      <form id="counterparty-form" className="grid min-w-0 gap-4" onSubmit={event => { event.preventDefault(); submit(); }}>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="counterparty-type">Тип *</Label>
          <Select value={form.type} onValueChange={value => { if (value === "SUPPLIER" || value === "CARRIER") setForm(previous => ({ ...previous, type: value })); }}>
            <SelectTrigger id="counterparty-type" aria-label="Тип контрагента" className="w-full"><SelectValue>{counterpartyTypeLabels[form.type]}</SelectValue></SelectTrigger>
            <SelectContent>{counterpartyTypes.map(type => <SelectItem key={type} value={type}>{counterpartyTypeLabels[type]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="counterparty-company">Компания *</Label>
          <Input id="counterparty-company" required value={form.company} onChange={event => setForm(previous => ({ ...previous, company: event.target.value }))} />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="counterparty-phone">Телефон</Label>
          <Input id="counterparty-phone" type="tel" value={form.phone} onChange={event => setForm(previous => ({ ...previous, phone: event.target.value }))} />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="counterparty-comment">Комментарий</Label>
          <Textarea id="counterparty-comment" className="max-h-64" value={form.comment} onChange={event => setForm(previous => ({ ...previous, comment: event.target.value }))} />
        </div>
        {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
      </form>
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Отмена</Button>
        <Button type="submit" form="counterparty-form" disabled={pending || !form.company.trim()}>{pending ? "Сохранение…" : "Сохранить"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
