"use client";
import { useEffect, useRef, useState, useTransition, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { addMaterial, updateMaterial } from "@/server/warehouse/actions";
import { materialSchema, type MaterialCreateOptions, type MaterialEditSnapshot } from "@/server/warehouse/material-contracts";
import type { StockMaterialOption } from "@/server/warehouse/contracts";

const empty = { name: "", sku: "", categoryId: "", unitId: "", minStock: "", comment: "" };
export function MaterialDialog({ open, onOpenChange, units, categories, editing, onCreated, showAccountingPrice = false, returnFocus }: MaterialCreateOptions & {
  open: boolean; onOpenChange: (open: boolean) => void; editing?: MaterialEditSnapshot | null;
  onCreated?: (material: StockMaterialOption) => void; showAccountingPrice?: boolean; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const router = useRouter(), [pending, startTransition] = useTransition();
  const [form, setForm] = useState(empty), [error, setError] = useState("");
  const initialized = useRef<{ open: boolean; id?: string }>({ open: false }), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (open && (!initialized.current.open || initialized.current.id !== editing?.id)) {
      setForm(editing ? { name: editing.name, sku: editing.sku ?? "", categoryId: editing.categoryId ?? "", unitId: editing.unitId,
        minStock: editing.minStock === null ? "" : String(editing.minStock), comment: editing.comment ?? "" }
        : { ...empty, unitId: units.find(unit => unit.id === "warehouse-unit-piece")?.id ?? units[0]?.id ?? "" });
      setError("");
    }
    initialized.current = { open, id: editing?.id };
  }, [open, editing, units]);
  const set = (field: keyof typeof empty, value: string) => setForm(current => ({ ...current, [field]: value }));
  const parsed = materialSchema.safeParse({ name: form.name, sku: form.sku.trim() || undefined, unitId: form.unitId,
    categoryId: form.categoryId || undefined, minStock: form.minStock.trim() ? Number(form.minStock) : undefined, comment: form.comment.trim() || undefined });
  const valid = parsed.success && units.some(unit => unit.id === form.unitId);
  return <Dialog open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }}>
    <DialogContent finalFocus={returnFocus} showCloseButton={!pending}>
      <DialogHeader><DialogTitle>{editing ? "Редактировать материал" : "Новый материал"}</DialogTitle>
        <DialogDescription>{showAccountingPrice ? "Учётная цена рассчитывается по остатку; минимальный остаток — необязателен" : "Материал появится в номенклатуре. Закупку нужно подтвердить отдельно."}</DialogDescription></DialogHeader>
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-1.5"><Label htmlFor="m-name">Название *</Label><Input id="m-name" value={form.name} onChange={event => set("name", event.target.value)} placeholder="ЛДСП 16 мм, Кромка ПВХ…" /></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5"><Label htmlFor="m-sku">Артикул</Label><Input id="m-sku" value={form.sku} onChange={event => set("sku", event.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="m-category">Категория</Label><SearchableSelect id="m-category" value={form.categoryId} onChange={value => set("categoryId", value)} allowClear
            options={categories.filter(category => category.active !== false).map(category => ({ value: category.id, label: category.name }))} placeholder="Без категории" searchPlaceholder="Поиск категории…" emptyText="Категория не найдена" /></div>
        </div>
        <div className={`grid grid-cols-1 gap-3 ${showAccountingPrice ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          <div className="flex flex-col gap-1.5"><Label htmlFor="m-unit">Единица *</Label><SearchableSelect id="m-unit" value={form.unitId} onChange={value => set("unitId", value)}
            options={units.map(unit => ({ value: unit.id, label: unit.name }))} placeholder="Выберите единицу" searchPlaceholder="Поиск единицы…" emptyText="Единиц нет — администратор может добавить их в настройках" /></div>
          {showAccountingPrice ? <div className="flex flex-col gap-1.5"><Label htmlFor="m-price">Учётная цена, BYN</Label><Input id="m-price" value={String(editing?.purchasePrice ?? 0)} readOnly /></div> : null}
          <div className="flex flex-col gap-1.5"><Label htmlFor="m-min">Мин. остаток</Label><Input id="m-min" inputMode="decimal" value={form.minStock} onChange={event => set("minStock", event.target.value)} placeholder="0" /></div>
        </div>
        <div className="flex flex-col gap-1.5"><Label htmlFor="m-comment">Комментарий</Label><Input id="m-comment" value={form.comment} onChange={event => set("comment", event.target.value)} placeholder="Необязательно" /></div>
      </fieldset>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter><Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Отмена</Button>
        <Button disabled={pending || !valid} onClick={() => startTransition(async () => {
          if (!parsed.success || !valid) return;
          setError("");
          try {
            const result = editing ? await updateMaterial(editing.id, parsed.data) : await addMaterial(parsed.data);
            if (!mounted.current) return;
            if (!result.ok) { setError(result.error ?? "Не удалось сохранить материал"); return; }
            if (!editing) {
              if (!("material" in result) || !result.material) { setError("Не удалось подтвердить созданный материал. Обновите номенклатуру."); return; }
              onCreated?.(result.material);
            }
            toast.success(editing ? "Сохранено" : "Материал создан"); onOpenChange(false); router.refresh();
          } catch { if (mounted.current) setError("Не удалось подтвердить сохранение. Проверьте номенклатуру перед повтором."); }
        })}>{pending ? "Сохранение…" : editing ? "Сохранить" : "Создать"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
