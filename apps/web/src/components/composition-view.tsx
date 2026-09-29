import React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { getProductComposition } from "@/server/composition/queries";
import { CompositionFinishDisplay, type CompositionFinish } from "./composition-finish-display";

export type CompositionData = NonNullable<Awaited<ReturnType<typeof getProductComposition>>>;
export type CompositionItem = CompositionData["items"][number] & { finishes: CompositionFinish[] };
export type CompositionViewData = Omit<CompositionData, "items"> & { items: CompositionItem[] };

const kindLabels = { MODULE: "Модуль", PART: "Деталь", HARDWARE: "Фурнитура" } as const;

export function CompositionView({ data, canEdit = false, authorNames = {}, onEdit, onDelete,
  onAddFinish, onEditFinish, onDeleteFinish }: {
  data: CompositionViewData; canEdit?: boolean; authorNames?: Record<string, string>;
  onEdit?: (item: CompositionItem) => void; onDelete?: (item: CompositionItem) => void;
  onAddFinish?: (item: CompositionItem) => void;
  onEditFinish?: (finish: CompositionFinish) => void;
  onDeleteFinish?: (finish: CompositionFinish) => void;
}) {
  const selected = data.selected;
  const children = new Map<string | null, CompositionItem[]>();
  for (const item of data.items) children.set(item.parentId, [...(children.get(item.parentId) ?? []), item]);
  const render = (parentId: string | null) => (children.get(parentId) ?? []).map((item) => (
    <li key={item.id} className="min-w-0 space-y-2">
      <div className="flex min-w-0 flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between sm:p-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{kindLabels[item.kind]}</Badge>
            {item.travelsToInstallation ? <Badge variant="secondary">Поедет на монтаж</Badge> : null}
          </div>
          <p className="min-w-0 break-words font-medium">{item.designation} · {item.title}</p>
          <p className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
            <span>{item.parentId ? "На родителя" : "Количество"}: {item.quantityPerParent}</span>
            <span>На изделие: {item.effectiveQuantity}</span>
          </p>
        </div>
        {canEdit && selected?.status === "DRAFT" ? <div className="flex gap-2">
          <Button type="button" variant="outline" size="icon" className="min-h-11 min-w-11" aria-label={`Изменить ${item.designation}`} onClick={() => onEdit?.(item)}>
            <Pencil className="size-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" className="min-h-11 min-w-11" aria-label={`Удалить ${item.designation}`} onClick={() => onDelete?.(item)}>
            <Trash2 className="size-4" />
          </Button>
        </div> : null}
      </div>
      <CompositionFinishDisplay
        finishes={item.finishes}
        canEdit={canEdit && selected?.status === "DRAFT"}
        onAdd={onAddFinish ? () => onAddFinish(item) : undefined}
        onEdit={onEditFinish}
        onDelete={onDeleteFinish}
      />
      {children.has(item.id) ? <details open className={item.depth < 3 ? "ml-2 min-w-0 border-l-2 pl-3 sm:ml-4" : "min-w-0"}>
        <summary className="min-h-11 cursor-pointer break-words py-2 text-sm text-muted-foreground">
          Состав модуля {item.designation}
        </summary>
        <ul className="min-w-0 space-y-2" aria-label={`Содержимое ${item.designation}`}>{render(item.id)}</ul>
      </details> : null}
    </li>
  ));

  return <Card className="min-w-0">
    <CardHeader className="min-w-0">
      <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
        {selected?.status === "CONFIRMED"
          ? `Ревизия ${selected.revisionNo} · Подтверждена`
          : selected?.status === "DRAFT" ? "Черновик, не подтверждён" : "Состав не задан"}
        {selected?.status === "CONFIRMED" && data.draft ? <Badge variant="secondary">Есть черновик</Badge> : null}
      </CardTitle>
      {selected?.confirmedAt ? <p className="text-sm text-muted-foreground">Подтвердил: {authorNames[selected.confirmedById ?? ""] ?? "—"} · {new Date(selected.confirmedAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}</p> : null}
      {selected?.status === "DRAFT" ? <p className="text-sm text-muted-foreground">Черновик создал: {authorNames[selected.createdById] ?? "—"}</p> : null}
    </CardHeader>
    <CardContent className="min-w-0">
      {data.items.length ? <ul className="space-y-3" aria-label="Строки состава">{render(null)}</ul>
        : <p className="text-sm text-muted-foreground">Позиции пока не добавлены.</p>}
    </CardContent>
  </Card>;
}
