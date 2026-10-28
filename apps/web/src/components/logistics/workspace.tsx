"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate, formatExactMoney, formatMoneyTotal, formatQty } from "@/lib/format";
import { LogisticsDocuments } from "./documents";
import { LogisticsTripDialog } from "./trip-editor";
import { LogisticsDeleteButton } from "./delete-button";
import { logisticsQueryUrl, percentLabel } from "./model";
import type { LogisticsWorkspaceData, ManagedTrip, ProjectBudget, TripRow } from "./types";

function tripProjects(row: TripRow) {
  return row.mode === "manage" ? row.shares.map(share => ({ id: share.projectId, number: share.projectNumber })) : row.projects;
}
function cost(row: ManagedTrip) {
  const posting = row.money.current;
  return posting ? formatExactMoney(posting.amount, posting.currency) : "Не списано";
}
function tripState(row: ManagedTrip) {
  return row.money.current ? "Списан" : row.documents.length ? "Ожидает списания" : "Нужна ТТН";
}
function BudgetSummary({ budget }: { budget: ProjectBudget }) {
  const overspent = budget.remaining !== null && budget.remaining < 0;
  const cards = [
    { label: "Доставка по КП", value: budget.deliveryBudget === null ? "Не указан" : formatMoneyTotal(budget.deliveryBudget) },
    { label: "Потрачено", value: formatMoneyTotal(budget.spent) },
    { label: overspent ? "Перерасход" : "Остаток", value: formatMoneyTotal(budget.remaining === null ? null : Math.abs(budget.remaining)) },
  ];
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map(card => (
          <Card key={card.label}><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{card.label}</CardTitle></CardHeader>
            <CardContent className="text-xl font-semibold">{card.value}</CardContent></Card>
        ))}
      </div>
      {budget.unavailableReason && <p className="text-sm text-muted-foreground">{budget.unavailableReason}</p>}
    </div>
  );
}

export function LogisticsWorkspace({ data }: { data: LogisticsWorkspaceData }) {
  const router = useRouter(), pathname = usePathname(), searchParams = useSearchParams();
  const [query, setQuery] = useState(data.query.query);
  const [dateFrom, setDateFrom] = useState(data.query.dateFrom ?? ""), [dateTo, setDateTo] = useState(data.query.dateTo ?? "");
  const [projectFilter, setProjectFilter] = useState(data.query.projectId ?? "");
  const [selected, setSelected] = useState<TripRow | null>(data.initialTrip);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const manage = data.mode === "manage", projectId = data.projectId;
  function deleted(tripId: string) {
    setSelected(previous => previous?.id === tripId ? null : previous);
    router.refresh();
  }
  function change(values: Record<string, string | number | undefined>) {
    router.replace(logisticsQueryUrl(pathname, searchParams.toString(), data.query, { page: 1, ...(projectId ? { tab: "logistics" } : {}), ...values }));
  }
  const columns: DataColumn<TripRow>[] = [
    { id: "date", header: "Дата", sortable: true, sortValue: row => row.date, cell: row => formatDate(row.date + "T00:00:00Z") },
    { id: "id", header: "Рейс", cell: row => <span className="font-medium">{row.id.slice(0, 8)}</span> },
    { id: "projects", header: "Проекты", className: "whitespace-normal", cell: row => tripProjects(row).map(project => <div key={project.id}>{project.number}</div>) },
  ];
  if (manage) {
    columns.push(
      { id: "manifest", header: "Отгрузка", className: "max-w-80 whitespace-normal", cell: row => row.mode === "manage"
        ? <div className="space-y-1">{row.lines.slice(0, 2).map(line => <p key={line.id}>{line.numberSnapshot ? line.numberSnapshot + " · " : ""}{line.nameSnapshot} · {formatQty(line.quantity)} {line.unitSnapshot}</p>)}{row.lines.length > 2 && <p className="text-xs text-muted-foreground">Ещё позиций: {row.lines.length - 2}</p>}</div> : null },
      { id: "cost", header: "Полная стоимость рейса", cell: row => row.mode === "manage" ? cost(row) : null },
      { id: "cash", header: "Касса", className: "whitespace-normal", cell: row => row.mode === "manage" ? row.money.current?.cashAccountName ?? "Не списано" : null },
    );
    if (projectId) {
      columns.push(
        { id: "share", header: "Доля проекта", cell: row => row.mode === "manage" ? percentLabel(row.shares.find(share => share.projectId === projectId)?.percentBps ?? 0) : null },
        { id: "project-cost", header: "Затраты проекта, BYN", cell: row => row.mode === "manage" ? row.money.current
          ? formatExactMoney(row.money.current.allocations.find(share => share.projectId === projectId)?.bynAmount ?? null, "BYN") : "Не списано" : null },
      );
    } else {
      columns.push({ id: "shares", header: "Доли проектов", className: "whitespace-normal", cell: row => row.mode === "manage"
        ? row.shares.map(share => <div key={share.id}>{share.projectNumber} · {percentLabel(share.percentBps)}</div>) : null });
    }
    columns.push({ id: "state", header: "Оформление", cell: row => row.mode === "manage" ? <Badge variant="outline">{tripState(row)}</Badge> : null });
  }
  columns.push({ id: "documents", header: "ТТН", className: "whitespace-normal", cell: row => <div>{row.documents.length ? row.documents.length + " файл(ов)" : "Нет ТТН"}{row.documents[0]?.ttnNumber && <p className="text-xs text-muted-foreground">№ {row.documents[0].ttnNumber}</p>}</div> });
  if (data.mode === "manage" && data.canDelete) columns.push({ id: "actions", header: "Действия",
    cell: row => row.mode === "manage" ? <LogisticsDeleteButton trip={row} onDeleted={() => deleted(row.id)} /> : null });

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-xl font-semibold">{projectId ? "Логистика проекта" : "Логистика"}</h2>
          <p className="text-sm text-muted-foreground">{manage ? "Одна строка — одна отгрузка. Общий рейс виден во всех его проектах." : "Накладные отгрузок: просмотр и скачивание ТТН."}</p>
        </div>
        {manage && <Button type="button" onClick={() => { setSelected(null); setCreating(true); }}><Plus className="size-4" />Новый рейс</Button>}
      </div>
      {data.mode === "manage" && data.budget && <BudgetSummary budget={data.budget} />}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <form className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={event => { event.preventDefault(); if (dateFrom && dateTo && dateFrom > dateTo) { setError("Дата начала должна быть не позже даты окончания"); return; } setError(""); change({ q: query, projectId: projectId ?? (projectFilter || undefined), dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }); }}>
        <label className="min-w-0 space-y-1 text-sm">Поиск по проекту или ТТН<Input value={query} maxLength={200} onChange={event => setQuery(event.target.value)} placeholder="Номер проекта, ТТН или рейса…" /></label>
        {data.mode === "manage" && !projectId && <label className="min-w-0 space-y-1 text-sm">Проект<SearchableSelect value={projectFilter} allowClear
          options={data.options.projects.map(project => ({ value: project.id, label: project.number + " · " + project.title }))}
          onChange={setProjectFilter} placeholder="Все проекты" /></label>}
        <label className="space-y-1 text-sm">Дата с<Input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} /></label>
        <label className="space-y-1 text-sm">Дата по<Input type="date" value={dateTo} min={dateFrom || undefined} onChange={event => setDateTo(event.target.value)} /></label>
        <Button type="submit" variant="outline" className="w-fit"><Search className="size-4" />Найти</Button>
      </form>

      <DataTable<TripRow> columns={columns} rows={data.rows} emptyText="Рейсов по выбранным условиям нет"
        onRowClick={row => { setCreating(false); setSelected(row); }}
        server={{ total: data.total, page: data.query.page, pageSize: data.query.pageSize, sort: "date", dir: data.query.direction,
          onPageChange: page => change({ page }), onPageSizeChange: pageSize => change({ pageSize }),
          onSortChange: (_column, direction) => change({ direction }) }}
        renderMobileCard={row => (
          <div className="min-w-0 space-y-2">
            <p className="text-xs text-muted-foreground">{formatDate(row.date + "T00:00:00Z")} · Рейс {row.id.slice(0, 8)}</p>
            <p className="break-words">{tripProjects(row).map(project => project.number).join(", ")}</p>
            {manage && row.mode === "manage" && <>
              <p>Полная стоимость рейса: <strong>{cost(row)}</strong></p>
              {projectId && <><p>Доля проекта: {percentLabel(row.shares.find(share => share.projectId === projectId)?.percentBps ?? 0)}</p>
                <p>Затраты проекта: {row.money.current ? formatExactMoney(row.money.current.allocations.find(share => share.projectId === projectId)?.bynAmount ?? null, "BYN") : "Не списано"}</p></>}
              <p className="text-xs text-muted-foreground">{tripState(row)}</p>
            </>}
            <p className="text-sm">ТТН: {row.documents.length} файл(ов)</p>
            <Button type="button" variant="outline" size="sm" onClick={() => { setCreating(false); setSelected(row); }}>{manage ? "Открыть рейс" : "Открыть ТТН"}</Button>
            {data.mode === "manage" && data.canDelete && row.mode === "manage" && <LogisticsDeleteButton trip={row} onDeleted={() => deleted(row.id)} />}
          </div>
        )} />

      {data.mode === "manage" && (creating || selected?.mode === "manage") && <LogisticsTripDialog
        key={creating ? "new" : selected!.id} trip={creating ? null : selected as ManagedTrip}
        options={data.options} moneyOptions={data.moneyOptions} projectId={projectId}
        onClose={() => { setCreating(false); setSelected(null); }}
        onReload={() => { setCreating(false); setSelected(null); router.refresh(); }}
        onSaved={close => { if (close) { setCreating(false); setSelected(null); } router.refresh(); }} />}
      {selected && (data.mode === "documents" || selected.mode === "documents") && (
        <Dialog open onOpenChange={open => { if (!open) setSelected(null); }}>
          <DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>ТТН рейса {selected.id.slice(0, 8)}</DialogTitle></DialogHeader>
            <p className="text-sm">{formatDate(selected.date + "T00:00:00Z")} · {tripProjects(selected).map(project => project.number).join(", ")}</p>
            <LogisticsDocuments documents={selected.documents} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
