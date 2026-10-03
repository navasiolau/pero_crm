"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FINISH_KIND_LABELS, type FinishFields, type FinishView } from "@/server/finishes/contracts";
import { createFinishAction, updateFinishAction, setFinishActiveAction } from "@/server/finishes/actions";
import {CatalogueSampleControl} from "@/components/catalogue-sample-control";
export function FinishesView({ rows, canManage }: { rows: FinishView[]; canManage: boolean }) {
  const router = useRouter(); const [pending, startTransition] = useTransition();
  const [editor, setEditor] = useState<{ row: FinishView | null } | null>(null);
  const [kind, setKind] = useState<FinishFields["kind"]>("ENAMEL"), [name, setName] = useState(""), [code, setCode] = useState(""), [color, setColor] = useState("");
  const [error, setError] = useState<string | null>(null);
  function open(row: FinishView | null) { setEditor({ row }); setKind(row?.kind ?? "ENAMEL"); setName(row?.name ?? ""); setCode(row?.code ?? ""); setColor(row?.color ?? ""); setError(null); }
  const columns: DataColumn<FinishView>[] = [
    { id: "kind", header: "Тип", cell: row => FINISH_KIND_LABELS[row.kind] },
    { id: "name", header: "Название", cell: row => <span className="break-words">{row.name}</span> },
    { id: "code", header: "Код", cell: row => <span className="break-all">{row.code}</span> },
    { id: "color", header: "Цвет", cell: row => <span className="break-words">{row.color}</span> },
    { id: "sample", header: "Образец", cell: row => <CatalogueSampleControl finishId={row.id} revision={row.revision} sampleAssetId={row.sampleAssetId} asset={row.sampleAsset} canManage={canManage}/> },
    { id: "active", header: "Статус", cell: row => <Badge variant={row.active ? "secondary" : "outline"}>{row.active ? "Активен" : "Неактивен"}</Badge> },
    ...(canManage ? [{ id: "actions", header: "", cell: (row: FinishView) => <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" onClick={event => { event.stopPropagation(); open(row); }}><Pencil className="size-4"/>Изменить</Button><Button variant="outline" size="sm" disabled={pending} onClick={event => { event.stopPropagation(); startTransition(async () => { setError(null); try { const result = await setFinishActiveAction({ id: row.id, active: !row.active, expectedRevision: row.revision }); if (!result.ok) { setError(result.error); return; } router.refresh(); } catch { setError("Не удалось изменить активность. Обновите каталог и повторите"); } }); }}>{row.active ? "Отключить" : "Включить"}</Button></div> } satisfies DataColumn<FinishView>] : []),
  ];
  return <div className="flex min-w-0 flex-col gap-5"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Покрытия</h1>{canManage ? <Button onClick={() => open(null)}><Plus className="size-4"/>Добавить вариант</Button> : null}</div>
    {error && !editor ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    <DataTable rows={rows} columns={columns} onRowClick={canManage ? row => open(row) : undefined} searchPlaceholder="Название, код или цвет…" emptyText="Вариантов отделки пока нет"/>
    {canManage ? <Dialog open={editor !== null} onOpenChange={value => { if (!pending && !value) setEditor(null); }}><DialogContent><DialogHeader><DialogTitle>{editor?.row ? "Изменить вариант" : "Новый вариант отделки"}</DialogTitle></DialogHeader><div className="flex min-w-0 flex-col gap-4">
      <div className="space-y-1.5"><Label>Тип</Label><Select value={kind} disabled={pending} onValueChange={value => { if (value && value in FINISH_KIND_LABELS) setKind(value as FinishFields["kind"]); }}><SelectTrigger className="w-full"><SelectValue>{FINISH_KIND_LABELS[kind]}</SelectValue></SelectTrigger><SelectContent>{Object.entries(FINISH_KIND_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label htmlFor="finish-name">Название</Label><Input id="finish-name" value={name} disabled={pending} maxLength={160} onChange={event => setName(event.target.value)}/></div>
      <div className="space-y-1.5"><Label htmlFor="finish-code">Код</Label><Input id="finish-code" value={code} disabled={pending} maxLength={80} onChange={event => setCode(event.target.value)}/></div>
      <div className="space-y-1.5"><Label htmlFor="finish-color">Цвет</Label><Input id="finish-color" value={color} disabled={pending} maxLength={120} onChange={event => setColor(event.target.value)}/></div>
      {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    </div><DialogFooter><Button variant="outline" disabled={pending} onClick={() => setEditor(null)}>Отмена</Button><Button disabled={pending || !name.trim() || !code.trim() || !color.trim()} onClick={() => startTransition(async () => { setError(null); try { const fields = { kind, name, code, color }; const result = editor?.row ? await updateFinishAction({ ...fields, id: editor.row.id, expectedRevision: editor.row.revision }) : await createFinishAction(fields); if (!result.ok) { setError(result.error); return; } setEditor(null); router.refresh(); } catch { setError("Не удалось подтвердить сохранение. Обновите каталог и проверьте результат"); } })}>Сохранить</Button></DialogFooter></DialogContent></Dialog> : null}
  </div>;
}
