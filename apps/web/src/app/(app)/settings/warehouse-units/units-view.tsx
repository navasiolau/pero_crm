"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addMaterialUnit, renameMaterialUnit, deleteMaterialUnit } from "@/server/warehouse/unit-actions";
import type { MaterialUnitView } from "@/server/warehouse/unit-contracts";

export function MaterialUnitsView({ rows }: { rows: MaterialUnitView[] }) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<MaterialUnitView | null>(null);
  const [deleting, setDeleting] = useState<MaterialUnitView | null>(null);
  const [name, setName] = useState("");
  function edit(row: MaterialUnitView | null) { setEditing(row); setName(row?.name ?? ""); setEditOpen(true); }
  const columns: DataColumn<MaterialUnitView>[] = [
    { id: "name", header: "Обозначение", sortable: true, sortValue: row => row.name, cell: row => <span className="font-medium">{row.name}</span> },
    { id: "usage", header: "В номенклатуре", cell: row => row.materialCount },
    { id: "actions", header: "", className: "w-24", cell: row => <div className="flex justify-end" onClick={event => event.stopPropagation()}>
      <Button variant="ghost" size="icon" aria-label={"Переименовать единицу " + row.name} disabled={pending} onClick={() => edit(row)}><Pencil className="size-4" /></Button>
      <Button variant="ghost" size="icon" aria-label={"Удалить единицу " + row.name} title={row.materialCount ? "Единица используется в номенклатуре, включая неактивные материалы" : "Удалить единицу"} disabled={pending || row.materialCount > 0} onClick={() => setDeleting(row)}><Trash2 className="size-4" /></Button>
    </div> },
  ];
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Единицы склада</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Единицу нельзя удалить, пока её использует номенклатура, включая неактивные материалы. Смена единицы не пересчитывает количества и цены.</p></div>
      <Button onClick={() => edit(null)}><Plus className="size-4" /> Добавить единицу</Button>
    </div>
    <DataTable rows={rows} columns={columns} searchPlaceholder="Поиск единицы…" emptyText="Единиц пока нет — добавьте первую" onRowClick={edit} />
    <Dialog open={editOpen} onOpenChange={setEditOpen}><DialogContent>
      <DialogHeader><DialogTitle>{editing ? "Переименовать единицу" : "Новая единица"}</DialogTitle><DialogDescription>Например: л, лист, 1/10 листа. При переименовании обновится обозначение у всех связанных материалов.</DialogDescription></DialogHeader>
      <div className="flex flex-col gap-1.5"><Label htmlFor="warehouse-unit-name">Обозначение *</Label><Input id="warehouse-unit-name" value={name} onChange={event => setName(event.target.value)} /></div>
      <DialogFooter><Button variant="outline" onClick={() => setEditOpen(false)}>Отмена</Button><Button disabled={pending || !name.trim()} onClick={() => startTransition(async () => {
        const result = editing ? await renameMaterialUnit(editing.id, { name }) : await addMaterialUnit({ name });
        if (result.ok) { toast.success(editing ? "Единица переименована" : "Единица добавлена"); setEditOpen(false); } else toast.error(result.error ?? "Ошибка");
      })}>{pending ? "Сохранение…" : "Сохранить"}</Button></DialogFooter>
    </DialogContent></Dialog>
    <ConfirmDeleteDialog entityLabel={"единицу «" + (deleting?.name ?? "") + "»"} open={!!deleting} onOpenChange={open => { if (!open) setDeleting(null); }} onConfirm={async () => {
      if (!deleting) return false;
      const result = await deleteMaterialUnit(deleting.id);
      if (!result.ok) { toast.error(result.error ?? "Ошибка"); return false; }
      toast.success("Единица удалена"); return true;
    }} />
  </div>;
}
