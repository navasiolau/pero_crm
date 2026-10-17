"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CounterpartyDialog } from "@/components/counterparty-dialog";
import { counterpartyTypeLabels, type CounterpartyView } from "@/server/counterparties/contracts";

type TypeFilter = "ALL" | CounterpartyView["type"];
const filterLabels: Record<TypeFilter, string> = { ALL: "Все", SUPPLIER: "Поставщики", CARRIER: "Перевозчики" };
const columns: DataColumn<CounterpartyView>[] = [
  { id: "company", header: "Компания", sortable: true, sortValue: row => row.company, cell: row => <span className="font-medium">{row.company}</span>, className: "max-w-sm whitespace-normal break-words" },
  { id: "type", header: "Тип", sortable: true, sortValue: row => counterpartyTypeLabels[row.type], cell: row => counterpartyTypeLabels[row.type] },
  { id: "phone", header: "Телефон", sortable: true, sortValue: row => row.phone ?? "", cell: row => row.phone ?? "—", className: "whitespace-normal" },
  { id: "comment", header: "Комментарий", sortValue: row => row.comment ?? "", cell: row => <span className="line-clamp-2 max-w-lg whitespace-normal break-words text-muted-foreground">{row.comment ?? "—"}</span> },
];

export function CounterpartiesView({ rows }: { rows: CounterpartyView[] }) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const [confirmed, setConfirmed] = useState<Record<string, CounterpartyView>>({});
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState("company"), [dir, setDir] = useState<"asc" | "desc">("asc");
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CounterpartyView | null>(null), [editOpen, setEditOpen] = useState(false);
  const records = useMemo(() => {
    const items = new Map(rows.map(row => [row.id, row]));
    for (const saved of Object.values(confirmed)) {
      const server = items.get(saved.id);
      if (!server || saved.revision > server.revision) items.set(saved.id, saved);
    }
    return [...items.values()];
  }, [rows, confirmed]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    const result = records.filter(row => (typeFilter === "ALL" || row.type === typeFilter) &&
      (!needle || [row.company, row.phone, row.comment].some(value => value?.toLocaleLowerCase("ru").includes(needle))));
    const getter = columns.find(column => column.id === sort)?.sortValue;
    return getter ? result.sort((a, b) => String(getter(a)).localeCompare(String(getter(b)), "ru") * (dir === "asc" ? 1 : -1)) : result;
  }, [records, query, typeFilter, sort, dir]);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / pageSize)));
  const viewing = records.find(row => row.id === viewingId) ?? null;
  function openEditor(item: CounterpartyView | null) { setViewingId(null); setEditing(item); setEditOpen(true); }

  return <div className="flex min-w-0 flex-col gap-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Контрагенты</h1><p className="text-sm text-muted-foreground">Поставщики и перевозчики. Клик по строке — карточка контрагента.</p></div>
      <Button onClick={() => openEditor(null)}><Plus className="size-4" /> Контрагент</Button>
    </div>
    <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,24rem)_14rem] sm:items-end">
      <div className="min-w-0 space-y-1.5"><Label htmlFor="counterparty-search">Поиск</Label><div className="relative"><Search className="absolute top-2.5 left-2 size-4 text-muted-foreground" /><Input id="counterparty-search" className="pl-8" placeholder="Компания, телефон, комментарий…" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></div></div>
      <div className="min-w-0 space-y-1.5"><Label htmlFor="counterparty-filter">Тип контрагента</Label><Select value={typeFilter} onValueChange={value => { if (value === "ALL" || value === "SUPPLIER" || value === "CARRIER") { setTypeFilter(value); setPage(1); } }}>
        <SelectTrigger id="counterparty-filter" aria-label="Фильтр типа" className="w-full"><SelectValue>{filterLabels[typeFilter]}</SelectValue></SelectTrigger>
        <SelectContent>{Object.entries(filterLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
      </Select></div>
    </div>
    <DataTable columns={columns} rows={filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)} emptyText="Контрагенты не найдены" onRowClick={row => setViewingId(row.id)}
      server={{ total: filtered.length, page: currentPage, pageSize, sort, dir, onPageChange: setPage,
        onSortChange: (id, direction) => { setSort(id); setDir(direction); setPage(1); }, onPageSizeChange: size => { setPageSize(size); setPage(1); } }}
      renderMobileCard={row => <div className="min-w-0 space-y-2 break-words"><div className="font-semibold">{row.company}</div><div className="text-sm text-muted-foreground">{counterpartyTypeLabels[row.type]}</div><div>{row.phone ?? "Телефон не указан"}</div>{row.comment ? <p className="line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{row.comment}</p> : null}</div>} />
    <Dialog open={!!viewing} onOpenChange={open => { if (!open) setViewingId(null); }}>
      <DialogContent initialFocus={heading}>
        <DialogHeader><DialogTitle ref={heading} tabIndex={-1} className="break-words pr-6 outline-none">{viewing?.company}</DialogTitle><DialogDescription>Карточка контрагента</DialogDescription></DialogHeader>
        {viewing ? <div className="min-w-0 space-y-4 text-sm"><div><div className="text-muted-foreground">Тип</div><div>{counterpartyTypeLabels[viewing.type]}</div></div><div><div className="text-muted-foreground">Телефон</div><div className="break-words">{viewing.phone ?? "—"}</div></div><div><div className="text-muted-foreground">Комментарий</div><div className="whitespace-pre-wrap break-words">{viewing.comment ?? "—"}</div></div></div> : null}
        <DialogFooter><Button variant="outline" onClick={() => { if (viewing) openEditor(viewing); }}><Pencil className="size-4" /> Редактировать</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <CounterpartyDialog open={editOpen} onOpenChange={setEditOpen} editing={editing} onSaved={item => { setConfirmed(previous => ({ ...previous, [item.id]: item })); setEditOpen(false); setViewingId(item.id); router.refresh(); }} />
  </div>;
}
