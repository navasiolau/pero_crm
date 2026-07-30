"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { PackagePlus, Pencil, Plus, Trash2, Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { formatAmount, formatQty } from "@/lib/format";
import { projectMaterialStatusLabels, stockMovementTypeLabels } from "@/lib/labels";
import {
  addProjectMaterial,
  deleteProjectMaterial,
  requestMaterial,
  returnMaterial,
  updateProjectMaterial,
} from "@/server/warehouse/actions";

// Локальные представления (структурно совпадают с серверными типами
// warehouse/queries — серверный модуль в клиент не импортируем)
export type ProjectMaterialLineStatus = "FULFILLED" | "AVAILABLE" | "SHORTAGE";

export type ProjectMaterialLineView = {
  id: string;
  materialId: string;
  materialName: string;
  materialSku: string | null;
  unit: string;
  purchasePrice: number | null; // учётная цена, BYN
  quantity: number; // сколько нужно
  issuedQty: number; // сколько уже выдано
  debt: number; // quantity − issuedQty
  available: number; // остаток на складе
  status: ProjectMaterialLineStatus;
  comment: string | null;
};

export type StockMovementRow = {
  id: string;
  type: "INCOME" | "EXPENSE" | "RETURN";
  materialId: string;
  materialName: string;
  materialUnit: string;
  quantity: number;
  unitPrice: number | null;
  totalByn: number | null;
  productId: string | null;
  productNumber: string | null;
  comment: string | null;
  createdByName: string | null;
  createdAt: string; // ISO
};

export type MaterialOptionView = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  purchasePrice: number | null;
  stock: number;
};

type DialogState =
  | { kind: "add" }
  | { kind: "request" | "return" | "edit" | "delete"; line: ProjectMaterialLineView }
  | null;

// Вкладка «Материалы» изделия (§12): потребность со статусами обеспечения
// (нехватка подсвечена красным), запрос/возврат со склада и журнал движений.
export function MaterialsTab({
  productId,
  lines,
  movements,
  materialsTotalByn,
  options,
  canManage,
  showMoney,
}: {
  productId: string;
  lines: ProjectMaterialLineView[];
  movements: StockMovementRow[];
  materialsTotalByn: number;
  options: MaterialOptionView[];
  canManage: boolean;
  showMoney: boolean;
}) {
  const [dialog, setDialog] = useState<DialogState>(null);

  const needsColumns: DataColumn<ProjectMaterialLineView>[] = [
    {
      id: "material",
      header: "Материал",
      sortable: true,
      sortValue: (row) => row.materialName,
      searchValue: (row) => `${row.materialName} ${row.materialSku ?? ""}`,
      cell: (row) => (
        <div className="flex flex-col">
          <span>{row.materialName}</span>
          {row.materialSku ? (
            <span className="text-xs text-muted-foreground">
              {row.materialSku}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "unit",
      header: "Ед.",
      cell: (row) => <span className="text-muted-foreground">{row.unit}</span>,
    },
    {
      id: "quantity",
      header: "Нужно",
      sortable: true,
      sortValue: (row) => row.quantity,
      headerClassName: "text-right",
      className: "text-right",
      cell: (row) => formatQty(row.quantity),
    },
    {
      id: "issued",
      header: "Выдано",
      sortable: true,
      sortValue: (row) => row.issuedQty,
      headerClassName: "text-right",
      className: "text-right",
      cell: (row) => formatQty(row.issuedQty),
    },
    {
      id: "debt",
      header: "Осталось",
      sortable: true,
      sortValue: (row) => row.debt,
      headerClassName: "text-right",
      className: "text-right",
      cell: (row) => formatQty(row.debt),
    },
    {
      id: "available",
      header: "На складе",
      sortable: true,
      sortValue: (row) => row.available,
      headerClassName: "text-right",
      className: "text-right",
      cell: (row) => (
        <span
          className={
            row.status === "SHORTAGE" ? "font-medium text-destructive" : undefined
          }
        >
          {formatQty(row.available)}
        </span>
      ),
    },
    ...(showMoney
      ? [
          {
            id: "price",
            header: "Цена",
            sortable: true,
            sortValue: (row: ProjectMaterialLineView) => row.purchasePrice ?? 0,
            headerClassName: "text-right",
            className: "text-right",
            cell: (row: ProjectMaterialLineView) =>
              formatAmount(row.purchasePrice, "BYN"),
          } satisfies DataColumn<ProjectMaterialLineView>,
        ]
      : []),
    {
      id: "status",
      header: "Статус",
      sortable: true,
      sortValue: (row) => projectMaterialStatusLabels[row.status] ?? row.status,
      cell: (row) => (
        <Badge
          variant={
            row.status === "SHORTAGE"
              ? "destructive"
              : row.status === "AVAILABLE"
                ? "default"
                : "secondary"
          }
        >
          {projectMaterialStatusLabels[row.status] ?? row.status}
        </Badge>
      ),
    },
    ...(canManage
      ? [
          {
            id: "actions",
            header: "",
            className: "w-32",
            cell: (row: ProjectMaterialLineView) => (
              <div className="flex items-center justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  title="Запросить со склада"
                  aria-label="Запросить со склада"
                  disabled={row.status === "FULFILLED" || row.available <= 0}
                  onClick={(event) => {
                    event.stopPropagation();
                    setDialog({ kind: "request", line: row });
                  }}
                >
                  <PackagePlus className="size-4 text-muted-foreground" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Вернуть на склад"
                  aria-label="Вернуть на склад"
                  disabled={row.issuedQty <= 0}
                  onClick={(event) => {
                    event.stopPropagation();
                    setDialog({ kind: "return", line: row });
                  }}
                >
                  <Undo2 className="size-4 text-muted-foreground" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Изменить"
                  aria-label="Изменить"
                  onClick={(event) => {
                    event.stopPropagation();
                    setDialog({ kind: "edit", line: row });
                  }}
                >
                  <Pencil className="size-4 text-muted-foreground" />
                </Button>
                {row.issuedQty === 0 ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Удалить"
                    aria-label="Удалить"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDialog({ kind: "delete", line: row });
                    }}
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                ) : null}
              </div>
            ),
          } satisfies DataColumn<ProjectMaterialLineView>,
        ]
      : []),
  ];

  const movementColumns: DataColumn<StockMovementRow>[] = [
    {
      id: "date",
      header: "Дата",
      sortable: true,
      sortValue: (row) => row.createdAt,
      cell: (row) => new Date(row.createdAt).toLocaleString("ru-RU"),
    },
    {
      id: "type",
      header: "Тип",
      sortable: true,
      sortValue: (row) => stockMovementTypeLabels[row.type] ?? row.type,
      cell: (row) => (
        <Badge variant={row.type === "EXPENSE" ? "destructive" : "secondary"}>
          {stockMovementTypeLabels[row.type] ?? row.type}
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
      headerClassName: "text-right",
      className: "text-right",
      cell: (row) =>
        `${row.type === "EXPENSE" ? "−" : "+"}${formatQty(row.quantity)} ${row.materialUnit}`,
    },
    ...(showMoney
      ? [
          {
            id: "sum",
            header: "Сумма",
            sortable: true,
            sortValue: (row: StockMovementRow) => row.totalByn ?? 0,
            headerClassName: "text-right",
            className: "text-right",
            cell: (row: StockMovementRow) => formatAmount(row.totalByn, "BYN"),
          } satisfies DataColumn<StockMovementRow>,
        ]
      : []),
    {
      id: "comment",
      header: "Комментарий",
      sortable: true,
      sortValue: (row) => row.comment ?? "",
      cell: (row) => row.comment ?? "—",
    },
    {
      id: "createdBy",
      header: "Кто внёс",
      sortable: true,
      sortValue: (row) => row.createdByName ?? "",
      cell: (row) => (
        <span className="text-muted-foreground">{row.createdByName ?? "—"}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Потребность в материалах (§12) */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Потребность в материалах</h3>
          {canManage ? (
            <Button onClick={() => setDialog({ kind: "add" })}>
              <Plus className="size-4" />
              Добавить материал
            </Button>
          ) : null}
        </div>
        {lines.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-10 text-center">
            <p className="text-muted-foreground">Материалы не добавлены</p>
            {canManage ? (
              <Button variant="outline" onClick={() => setDialog({ kind: "add" })}>
                <Plus className="size-4" />
                Добавить материал
              </Button>
            ) : null}
          </div>
        ) : (
          <DataTable
            columns={needsColumns}
            rows={lines}
            searchPlaceholder="Поиск по материалам…"
            emptyText="Материалы не добавлены"
            rowClassName={(row) =>
              row.status === "SHORTAGE" ? "bg-red-500/10" : undefined
            }
          />
        )}
      </div>

      {/* Взято со склада: списания и возвраты по проекту */}
      <div className="flex flex-col gap-3">
        <h3 className="text-lg font-semibold">Взято со склада</h3>
        <DataTable
          columns={movementColumns}
          rows={movements}
          searchPlaceholder="Поиск по движениям…"
          emptyText="Со склада ещё ничего не брали"
        />
        {showMoney ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              Итого материалов: {formatAmount(materialsTotalByn, "BYN")}
            </p>
            <p className="text-xs text-muted-foreground">
              Материалы учитываются в марже автоматически (вкладка
              «Финансы»).
            </p>
          </div>
        ) : null}
      </div>

      <AddMaterialDialog
        open={dialog?.kind === "add"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        productId={productId}
        options={options}
      />

      {dialog && dialog.kind !== "add" && dialog.kind !== "delete" ? (
        <LineActionDialog
          kind={dialog.kind}
          line={dialog.line}
          showMoney={showMoney}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      ) : null}

      <ConfirmDeleteDialog
        entityLabel="строку потребности"
        open={dialog?.kind === "delete"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        warning={
          dialog?.kind === "delete"
            ? `${dialog.line.materialName} × ${formatQty(dialog.line.quantity)} ${dialog.line.unit}.`
            : undefined
        }
        onConfirm={async () => {
          if (dialog?.kind !== "delete") return false;
          const result = await deleteProjectMaterial(dialog.line.id);
          if (result.ok) {
            toast.success("Строка потребности удалена");
            return true;
          }
          toast.error(result.error ?? "Ошибка удаления");
          return false;
        }}
      />
    </div>
  );
}

// Диалог добавления материала в потребность изделия (§12): фиксируется без
// проверки остатка — нехватка подсветится красным в таблице.
function AddMaterialDialog({
  open,
  onOpenChange,
  productId,
  options,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  options: MaterialOptionView[];
}) {
  const [pending, startTransition] = useTransition();
  const [materialId, setMaterialId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [comment, setComment] = useState("");

  // Сброс формы при каждом открытии
  useEffect(() => {
    if (open) {
      setMaterialId("");
      setQuantity("");
      setComment("");
    }
  }, [open]);

  const parsedQuantity = quantity.trim() === "" ? NaN : Number(quantity);
  const canSubmit =
    !pending && materialId !== "" && Number.isFinite(parsedQuantity) && parsedQuantity > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Добавить материал</DialogTitle>
          <DialogDescription>
            Потребность фиксируется без проверки остатка — нехватка подсветится
            красным
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Материал *</Label>
            <SearchableSelect
              options={options.map((option) => ({
                value: option.id,
                label: option.name,
                hint: [
                  option.sku,
                  `на складе ${formatQty(option.stock)} ${option.unit}`,
                ]
                  .filter(Boolean)
                  .join(" · "),
              }))}
              value={materialId}
              onChange={setMaterialId}
              placeholder="Выберите материал…"
              searchPlaceholder="Поиск материала…"
              emptyText="Материалов нет — заведите их в разделе «Склад»"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mat-add-qty">Количество *</Label>
            <Input
              id="mat-add-qty"
              type="number"
              min="0"
              step="0.001"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              placeholder="0"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mat-add-comment">Комментарий</Label>
            <Input
              id="mat-add-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Например: на фасады"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              startTransition(async () => {
                const result = await addProjectMaterial({
                  productId,
                  materialId,
                  quantity: parsedQuantity,
                  comment: comment.trim() || undefined,
                });
                if (result.ok) {
                  toast.success("Материал добавлен в потребность");
                  onOpenChange(false);
                } else {
                  toast.error(result.error ?? "Ошибка");
                }
              })
            }
          >
            {pending ? "Сохранение…" : "Добавить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Диалог действия со строкой потребности: запрос со склада (списание),
// возврат на склад или изменение количества/комментария.
function LineActionDialog({
  kind,
  line,
  showMoney,
  open,
  onOpenChange,
}: {
  kind: "request" | "return" | "edit";
  line: ProjectMaterialLineView;
  showMoney: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [comment, setComment] = useState("");

  const maxQuantity =
    kind === "request"
      ? Math.min(line.debt, line.available)
      : kind === "return"
        ? line.issuedQty
        : null; // у правки потолка нет, только пол ≥ выданного

  // Дефолты при каждом открытии
  useEffect(() => {
    if (open) {
      setQuantity(
        kind === "edit"
          ? String(line.quantity)
          : String(maxQuantity ?? line.debt),
      );
      setUnitPrice(line.purchasePrice === null ? "" : String(line.purchasePrice));
      setComment(kind === "edit" ? (line.comment ?? "") : "");
    }
  }, [open, kind, line, maxQuantity]);

  const parsedQuantity = quantity.trim() === "" ? NaN : Number(quantity);
  const parsedPrice = unitPrice.trim() === "" ? NaN : Number(unitPrice);

  const quantityValid =
    Number.isFinite(parsedQuantity) &&
    parsedQuantity > 0 &&
    (maxQuantity === null || parsedQuantity <= maxQuantity) &&
    (kind !== "edit" || parsedQuantity >= line.issuedQty);
  const priceValid =
    unitPrice.trim() === "" || (Number.isFinite(parsedPrice) && parsedPrice >= 0);
  const canSubmit = !pending && quantityValid && priceValid;

  const titles = {
    request: "Запросить со склада",
    return: "Вернуть на склад",
    edit: "Изменить потребность",
  } as const;

  const submitLabels = {
    request: "Запросить",
    return: "Вернуть",
    edit: "Сохранить",
  } as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titles[kind]}</DialogTitle>
          <DialogDescription>
            {line.materialName}
            {kind === "request"
              ? ` · доступно на складе: ${formatQty(line.available)} ${line.unit}`
              : kind === "return"
                ? ` · выдано на изделие: ${formatQty(line.issuedQty)} ${line.unit}`
                : ` · уже выдано: ${formatQty(line.issuedQty)} ${line.unit} — меньше поставить нельзя`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mat-line-qty">Количество, {line.unit} *</Label>
            <Input
              id="mat-line-qty"
              type="number"
              min="0"
              step="0.001"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
            {maxQuantity !== null ? (
              <p className="text-xs text-muted-foreground">
                Не больше {formatQty(maxQuantity)} {line.unit}
              </p>
            ) : null}
          </div>
          {kind !== "edit" && showMoney ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mat-line-price">Цена, BYN за {line.unit}</Label>
              <Input
                id="mat-line-price"
                type="number"
                min="0"
                step="0.01"
                value={unitPrice}
                onChange={(event) => setUnitPrice(event.target.value)}
                placeholder="Учётная цена"
              />
              <p className="text-xs text-muted-foreground">
                Пусто — учётная цена материала
              </p>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mat-line-comment">Комментарий</Label>
            <Input
              id="mat-line-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              startTransition(async () => {
                const price =
                  unitPrice.trim() === "" ? undefined : parsedPrice;
                const result =
                  kind === "request"
                    ? await requestMaterial({
                        projectMaterialId: line.id,
                        quantity: parsedQuantity,
                        unitPrice: price,
                        comment: comment.trim() || undefined,
                      })
                    : kind === "return"
                      ? await returnMaterial({
                          projectMaterialId: line.id,
                          quantity: parsedQuantity,
                          unitPrice: price,
                          comment: comment.trim() || undefined,
                        })
                      : await updateProjectMaterial({
                          id: line.id,
                          quantity: parsedQuantity,
                          comment: comment.trim() || undefined,
                        });
                if (result.ok) {
                  toast.success(
                    kind === "request"
                      ? "Материал списан на изделие"
                      : kind === "return"
                        ? "Материал возвращён на склад"
                        : "Потребность обновлена",
                  );
                  onOpenChange(false);
                } else {
                  toast.error(result.error ?? "Ошибка");
                }
              })
            }
          >
            {pending ? "Сохранение…" : submitLabels[kind]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
