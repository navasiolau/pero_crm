"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {Button} from '@/components/ui/button';
import {WarehouseMovementDeleteDialog} from '@/components/warehouse-movement-delete-dialog';

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatAmount, formatQty, formatDateTime } from "@/lib/format";
import {ReportDocumentButton} from '@/components/report-document-button';
import { warehouseMovementKindLabels, warehouseMovementLabel, matchesWarehouseMovementKind } from "@/lib/warehouse-movement-labels";
import type {
  MaterialOption,
  StockMovementView,
} from "@/server/warehouse/queries";

// Журнал движений склада. Фильтры — на клиенте по уже загруженным
// 500 записям (серверная выборка без фильтра).
export function MovementsView({
  rows,
  materials,
  showMoney,
  canDelete = false,
}: {
  rows: StockMovementView[];
  materials: MaterialOption[];
  showMoney: boolean;
  canDelete?: boolean;
}) {
  const [materialId, setMaterialId] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [deleting,setDeleting]=useState<string|null>(null);
  const deleteButton=(row:StockMovementView)=>canDelete?<Button variant="ghost" size="sm" className="text-destructive" onClick={event=>{event.stopPropagation();setDeleting(row.id);}}>Удалить</Button>:null;

  const materialOptions = useMemo(
    () =>
      materials.map((material) => ({
        value: material.id,
        label: material.name,
        hint: material.sku ?? undefined,
      })),
    [materials],
  );

  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          (materialId === "" || row.materialId === materialId) &&
          matchesWarehouseMovementKind(row, typeFilter),
      ),
    [rows, materialId, typeFilter],
  );

  const columns: DataColumn<StockMovementView>[] = [
    {
      id: "date",
      header: "Дата",
      sortable: true,
      sortValue: (row) => row.createdAt,
      cell: (row) => formatDateTime(row.createdAt),
    },
    {
      id: "type",
      header: "Тип",
      sortable: true,
      sortValue: (row) => warehouseMovementLabel(row),
      cell: (row) => (
        <Badge
          variant={
            row.type === "INCOME"
              ? "default"
              : row.type === "EXPENSE"
                ? "destructive"
                : "outline"
          }
        >
          {warehouseMovementLabel(row)}
        </Badge>
      ),
    },
    {
      id: "material",
      header: "Материал",
      sortable: true,
      sortValue: (row) => row.materialName,
      cell: (row) => row.materialName,
    },
    {
      id: "quantity",
      header: "Кол-во",
      sortable: true,
      sortValue: (row) => row.quantity,
      className: "text-right font-medium",
      headerClassName: "text-right",
      cell: (row) => (
        <span>
          {row.type === "EXPENSE" ? "−" : row.type === "RETURN" ? "+" : ""}
          {formatQty(row.quantity)} {row.materialUnit}
        </span>
      ),
    },
  ];

  if (showMoney) {
    columns.push(
      {
        id: "price",
        header: "Цена",
        sortable: true,
        sortValue: (row) => row.unitPrice ?? -1,
        className: "text-right",
        headerClassName: "text-right",
        cell: (row) => (
          <span className="text-muted-foreground">
            {formatAmount(row.unitPrice, "BYN")}
          </span>
        ),
      },
      {
        id: "total",
        header: "Сумма",
        sortable: true,
        sortValue: (row) => row.totalByn ?? -1,
        className: "text-right",
        headerClassName: "text-right",
        cell: (row) => formatAmount(row.totalByn, "BYN"),
      },
    );
  }

  columns.push(
    {id:'document',header:'Отчетный документ',searchValue:row=>row.reportDocument?.fileName??'',cell:row=><ReportDocumentButton document={row.reportDocument}/>},
    {
      id: "product",
      header: "Изделие",
      sortable: true,
      sortValue: (row) => row.productNumber ?? "",
      cell: (row) =>
        row.productId && row.productNumber ? (
          <Link
            href={`/products/${row.productId}`}
            className="text-primary hover:underline"
          >
            {row.productNumber}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "comment",
      header: "Комментарий",
      sortValue: (row) => row.comment ?? "",
      cell: (row) => (
        <span className="text-muted-foreground">{row.comment ?? "—"}</span>
      ),
    },
    {
      id: "author",
      header: "Кто внёс",
      sortable: true,
      sortValue: (row) => row.createdByName ?? "",
      cell: (row) => (
        <span className="text-muted-foreground">
          {row.createdByName ?? "—"}
        </span>
      ),
    },
  );

  if(canDelete)columns.push({id:'actions',header:'',cell:deleteButton});
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Движения</h1>
        <p className="text-sm text-muted-foreground">
          Приходы, списания на изделия и возвраты — последние 500 операций
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchableSelect
          options={materialOptions}
          value={materialId}
          onChange={setMaterialId}
          placeholder="Все материалы"
          searchPlaceholder="Поиск материала…"
          emptyText="Материал не найден"
          allowClear
          className="w-72"
        />
        <Select
          value={typeFilter}
          onValueChange={(next) => setTypeFilter(next ?? "ALL")}
        >
          <SelectTrigger className="w-64">
            <SelectValue>
              {typeFilter === "ALL"
                ? "Все типы"
                : warehouseMovementKindLabels[typeFilter]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Все типы</SelectItem>
            {Object.entries(warehouseMovementKindLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        searchPlaceholder="Поиск по движениям…"
        emptyText="Движений пока нет"
        defaultPageSize={20}
        renderMobileCard={row=><div className="space-y-2"><div className="flex flex-wrap items-start justify-between gap-2"><b className="break-words">{row.materialName}</b><Badge variant="outline">{warehouseMovementLabel(row)}</Badge></div><p className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</p><p>{row.type==='EXPENSE'?'−':row.type==='RETURN'?'+':''}{formatQty(row.quantity)} {row.materialUnit}{showMoney?` · ${formatAmount(row.totalByn,'BYN')}`:''}</p>{row.productId&&row.productNumber?<Link href={`/products/${row.productId}`} className="text-primary hover:underline">Изделие {row.productNumber}</Link>:null}{row.comment?<p className="break-words text-sm">{row.comment}</p>:null}{row.createdByName?<p className="text-xs text-muted-foreground">{row.createdByName}</p>:null}<ReportDocumentButton document={row.reportDocument}/>{deleteButton(row)}</div>}
      />
      {deleting?<WarehouseMovementDeleteDialog key={deleting} movementId={deleting} onClose={()=>setDeleting(null)}/>:null}
    </div>
  );
}
