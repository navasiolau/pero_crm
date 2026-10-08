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
import { StockMovementDialog } from "@/components/stock-movement-dialog";
import type { WarehouseReturnSource } from "@/server/warehouse/contracts";
import { scaleNorm, materialPlanFloor } from "@/lib/product-quantity";
import {quantityInput} from '@/lib/warehouse-cost';
import { formatAmount, formatMoneyTotal, formatQty } from "@/lib/format";
import { projectMaterialStatusLabels, stockMovementTypeLabels } from "@/lib/labels";
import {
  addProjectMaterial,
  deleteProjectMaterial,
  updateProjectMaterial,
} from "@/server/warehouse/actions";

import type { ProjectMaterialLine as ProjectMaterialLineView, StockMovementView as StockMovementRow, MaterialOption as MaterialOptionView } from "@/server/warehouse/contracts";
export type { ProjectMaterialLine as ProjectMaterialLineView, ProjectMaterialLineStatus, StockMovementView as StockMovementRow, MaterialOption as MaterialOptionView } from "@/server/warehouse/contracts";
type DialogState =
  | { kind: "add" }
  | { kind: "issue" | "return"; materialId?: string; sourceId?: string }
  | { kind: "edit" | "delete"; line: ProjectMaterialLineView }
  | null;

// Вкладка «Материалы» изделия (§12): потребность со статусами обеспечения
// (нехватка подсвечена красным), запрос/возврат со склада и журнал движений.
export function MaterialsTab({
  productId,
  productQuantity = 1,
  lines,
  movements,
  materialsTotalByn,
  options,
  issueOptions,
  returnSources,
  warehouseReady,
  canManage,
  canIssueReturn = canManage,
  showMoney,
}: {
  productId: string;
  productQuantity?: number;
  lines: ProjectMaterialLineView[];
  movements: StockMovementRow[];
  materialsTotalByn: number | null;
  options: MaterialOptionView[];
  issueOptions: MaterialOptionView[];
  returnSources: WarehouseReturnSource[];
  warehouseReady: boolean;
  canManage: boolean;
  canIssueReturn?: boolean;
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
      id: "quantityPerUnit",
      header: "На 1 изделие",
      cell: (row) => formatQty(row.quantityPerUnit),
    },
    {
      id: "quantity",
      header: "Нужно всего",
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
    ...(canManage || canIssueReturn
      ? [
          {
            id: "actions",
            header: "",
            className: "w-32",
            cell: (row: ProjectMaterialLineView) => (
              <div className="flex items-center justify-end gap-1">
                {canIssueReturn?<>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Выдать со склада"
                  aria-label="Выдать со склада"
                  disabled={!warehouseReady || row.available <= 0}
                  onClick={(event) => {
                    event.stopPropagation();
                    setDialog({ kind: "issue", materialId: row.materialId });
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
                    setDialog({ kind: "return", materialId: row.materialId });
                  }}
                >
                  <Undo2 className="size-4 text-muted-foreground" />
                </Button>
                </>:null}
                {canManage?<>
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
                </>:null}
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

  if(canIssueReturn)movementColumns.push({id:"return",header:"",cell:row=>row.type==="EXPENSE"&&Number(row.returnableQuantity)>0
    ? <Button variant="ghost" disabled={!warehouseReady} onClick={event=>{event.stopPropagation();setDialog({kind:"return",sourceId:row.id});}}>Вернуть</Button>:null});
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
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Взято со склада</h3>
          {canIssueReturn?<div className="flex flex-wrap gap-2"><Button disabled={!warehouseReady} onClick={()=>setDialog({kind:"issue"})}><PackagePlus className="size-4"/>Выдать материал</Button><Button variant="outline" disabled={!warehouseReady||(!returnSources.length&&!lines.some(line=>line.legacyReturnQuantity>0))} onClick={()=>setDialog({kind:"return"})}><Undo2 className="size-4"/>Вернуть материал</Button></div>:null}
        </div>
        {canIssueReturn&&!warehouseReady?<p className="text-sm text-muted-foreground">Склад временно закрыт для операций.</p>:null}
        <DataTable
          columns={movementColumns}
          rows={movements}
          searchPlaceholder="Поиск по движениям…"
          emptyText="Со склада ещё ничего не брали"
        />
        {showMoney ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              Итого материалов: {formatMoneyTotal(materialsTotalByn, "BYN")}
            </p>
            <p className="text-xs text-muted-foreground">
              Итог учитывает все движения; в журнале показаны последние 500. Материалы учитываются в марже автоматически (вкладка
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
        productQuantity={productQuantity}
        options={options}
      />

      {dialog?.kind === "edit" ? (
        <EditMaterialDialog
          line={dialog.line}
          productQuantity={productQuantity}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      ) : null}

      {dialog?.kind==="issue"||dialog?.kind==="return"?<StockMovementDialog mode={dialog.kind} productId={productId} options={issueOptions} sources={returnSources} lines={lines} initialMaterialId={dialog.materialId} initialSourceId={dialog.sourceId} warehouseReady={warehouseReady} showMoney={showMoney} onClose={()=>setDialog(null)}/>:null}

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
  productQuantity = 1,
  options,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productQuantity?: number;
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
            <Label htmlFor="mat-add-qty">Количество на 1 изделие *</Label>
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
          <p className="text-sm text-muted-foreground">На партию: {Number.isFinite(parsedQuantity) ? `${formatQty(parsedQuantity)} × ${productQuantity} = ${formatQty(parsedQuantity * productQuantity)}` : "—"}</p>
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
                  quantityPerUnit: parsedQuantity,
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

// План редактируется отдельно от физических движений.
function EditMaterialDialog({productQuantity,line,open,onOpenChange}:{productQuantity:number;line:ProjectMaterialLineView;open:boolean;onOpenChange:(value:boolean)=>void}) {
  const [pending,startTransition]=useTransition(),[quantity,setQuantity]=useState(String(line.quantityPerUnit)),[comment,setComment]=useState(line.comment??"");
  let parsedQuantity=NaN,plannedQuantity=NaN;
  try{parsedQuantity=Number(quantityInput(quantity));plannedQuantity=Number(scaleNorm(parsedQuantity,productQuantity,3,12));}catch{}
  const floor=Number(materialPlanFloor(line.quantity,line.issuedQty));
  return <Dialog open={open} onOpenChange={value=>{if(!pending)onOpenChange(value);}}><DialogContent><DialogHeader>
    <DialogTitle>Изменить потребность</DialogTitle><DialogDescription>{line.materialName} · уже выдано {formatQty(line.issuedQty)} {line.unit}; минимальный план до возврата: {formatQty(floor)} {line.unit}</DialogDescription>
  </DialogHeader><fieldset disabled={pending} className="flex flex-col gap-3">
    <div className="flex flex-col gap-1.5"><Label htmlFor="mat-line-qty">На 1 изделие, {line.unit} *</Label><Input id="mat-line-qty" inputMode="decimal" value={quantity} onChange={event=>setQuantity(event.target.value)}/></div>
    <p className="text-sm text-muted-foreground">Всего: {Number.isFinite(plannedQuantity)?formatQty(plannedQuantity):"—"} {line.unit}</p>
    <div className="flex flex-col gap-1.5"><Label htmlFor="mat-line-comment">Комментарий</Label><Input id="mat-line-comment" value={comment} onChange={event=>setComment(event.target.value)}/></div>
  </fieldset><DialogFooter><Button variant="outline" disabled={pending} onClick={()=>onOpenChange(false)}>Отмена</Button><Button disabled={pending||!Number.isFinite(plannedQuantity)||plannedQuantity<floor} onClick={()=>startTransition(async()=>{
    const result=await updateProjectMaterial({id:line.id,quantityPerUnit:parsedQuantity,comment:comment.trim()||undefined});
    if(result.ok){toast.success("Потребность обновлена");onOpenChange(false);}else toast.error(result.error??"Ошибка");
  })}>{pending?"Сохранение…":"Сохранить"}</Button></DialogFooter></DialogContent></Dialog>;
}
