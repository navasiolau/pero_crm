"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { formatAmount, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addStockIncome } from "@/server/warehouse/actions";
import {priceInput,quantityInput} from '@/lib/warehouse-cost';
import type { MaterialOption, MaterialView } from "@/server/warehouse/queries";

// Остатки склада: остаток = приходы + возвраты − списания (считает сервер).
// Красным — остаток ниже минимального и нехватка по проектам.
export function StockView({
  rows,
  materials,
  canManage,
  showMoney,
}: {
  rows: MaterialView[];
  materials: MaterialOption[];
  canManage: boolean;
  showMoney: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [incomeOpen, setIncomeOpen] = useState(false);
  const [materialId, setMaterialId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [comment, setComment] = useState("");
  const [clientMutationId,setClientMutationId]=useState(()=>crypto.randomUUID());

  const materialOptions = useMemo(
    () =>
      materials.map((material) => ({
        value: material.id,
        label: material.name,
        hint: `${material.sku ? `${material.sku} · ` : ""}остаток ${formatQty(material.stock)} ${material.unit}`,
      })),
    [materials],
  );

  const columns: DataColumn<MaterialView>[] = [
    {
      id: "name",
      header: "Материал",
      sortable: true,
      sortValue: (row) => row.name,
      searchValue: (row) => `${row.name} ${row.sku ?? ""}`,
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.name}</span>
          {row.sku ? (
            <span className="text-xs text-muted-foreground">{row.sku}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: "category",
      header: "Категория",
      sortable: true,
      sortValue: (row) => row.categoryName ?? "",
      cell: (row) => (
        <span className="text-muted-foreground">{row.categoryName ?? "—"}</span>
      ),
    },
    {
      id: "unit",
      header: "Ед.",
      sortable: true,
      sortValue: (row) => row.unit,
      cell: (row) => row.unit,
    },
    {
      id: "stock",
      header: "Остаток",
      sortable: true,
      sortValue: (row) => row.stock,
      className: "text-right font-medium",
      headerClassName: "text-right",
      cell: (row) => {
        const low = row.minStock !== null && row.stock < row.minStock;
        return (
          <span
            className={cn(low && "text-red-600")}
            title={low ? "Ниже минимального остатка" : undefined}
          >
            {formatQty(row.stock)}
          </span>
        );
      },
    },
    {
      id: "short",
      header: "Не хватает по проектам",
      sortable: true,
      sortValue: (row) => row.shortByProjects,
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) =>
        row.shortByProjects > 0 ? (
          <span className="font-medium text-red-600">
            {formatQty(row.shortByProjects)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  if (showMoney) {
    columns.push({
      id: "price",
      header: "Учётная цена",
      sortable: true,
      sortValue: (row) => row.purchasePrice ?? -1,
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span className="text-muted-foreground">
          {formatAmount(row.purchasePrice, "BYN")}
        </span>
      ),
    });
  }

  let incomeValid=false;
  try{quantityInput(quantity);priceInput(unitPrice);incomeValid=materialId!=='';}catch{}

  function resetIncomeForm() {
    setMaterialId("");
    setQuantity("");
    setUnitPrice("");
    setComment("");
    setClientMutationId(crypto.randomUUID());
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Остатки</h1>
          <p className="text-sm text-muted-foreground">
            Остаток — приходы и возвраты минус списания на проекты
          </p>
        </div>
        {canManage ? (
          <Button disabled={rows.some(row=>!row.warehouseReady)} onClick={() => setIncomeOpen(true)}>
            <Plus className="size-4" />
            Приход
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        searchPlaceholder="Поиск по материалам…"
        emptyText="Материалов пока нет — заведите их в номенклатуре"
      />

      <Dialog
        open={incomeOpen}
        onOpenChange={(next) => {
          if (!next) resetIncomeForm();
          setIncomeOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Приход на склад</DialogTitle>
            <DialogDescription>
              Поступление материала увеличит остаток; цена — BYN за единицу
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Материал *</Label>
              <SearchableSelect
                options={materialOptions}
                value={materialId}
                onChange={setMaterialId}
                placeholder="Выберите материал…"
                searchPlaceholder="Поиск материала…"
                emptyText="Материал не найден"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="income-qty">Количество *</Label>
                <Input
                  id="income-qty"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="income-price">Цена, BYN *</Label>
                <Input
                  id="income-price"
                  inputMode="decimal"
                  value={unitPrice}
                  onChange={(event) => setUnitPrice(event.target.value)}
                  placeholder="Больше нуля"
                  required
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="income-comment">Комментарий</Label>
              <Input
                id="income-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Необязательно"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIncomeOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={pending || !incomeValid}
              onClick={() =>
                startTransition(async () => {
                  const result = await addStockIncome({
                    materialId,
                    quantity,
                    unitPrice,
                    clientMutationId,
                    comment: comment.trim() || undefined,
                  });
                  if (result.ok) {
                    toast.success("Приход внесён");
                    setIncomeOpen(false);
                    resetIncomeForm();
                  } else {
                    toast.error(result.error ?? "Ошибка");
                  }
                })
              }
            >
              {pending ? "Сохранение…" : "Внести приход"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
