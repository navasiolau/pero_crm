"use client";

import { useRef, useState, useTransition } from "react";
import { FolderPlus, Pencil, Plus, Power } from "lucide-react";
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
import { MaterialDialog } from "@/components/material-dialog";
import { formatAmount, formatQty } from "@/lib/format";
import type { MaterialUnitOption } from "@/server/warehouse/unit-contracts";
import { cn } from "@/lib/utils";
import {
  addMaterialCategory,
  toggleMaterial,
  toggleMaterialCategory,
} from "@/server/warehouse/actions";
import type {
  MaterialCategoryView,
  MaterialView,
} from "@/server/warehouse/queries";

// Номенклатура склада: материалы с остатками, категории, учётные цены.
// Материал/категория с историей не удаляются — деактивируются (иконка Power).
export function ItemsView({
  rows,
  categories,
  units,
  canManage,
  showMoney,
}: {
  rows: MaterialView[];
  categories: MaterialCategoryView[];
  units: MaterialUnitOption[];
  canManage: boolean;
  showMoney: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<MaterialView | null>(null);
  const [viewing, setViewing] = useState<MaterialView | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const createButton = useRef<HTMLButtonElement>(null);

  function openCreate() { setEditing(null); setEditOpen(true); }
  function openEdit(material: MaterialView) { setEditing(material); setEditOpen(true); }

  const columns: DataColumn<MaterialView>[] = [
    {
      id: "name",
      header: "Название",
      sortable: true,
      sortValue: (row) => row.name,
      cell: (row) => (
        <span
          className={cn(
            "font-medium",
            !row.active && "text-muted-foreground line-through",
          )}
        >
          {row.name}
        </span>
      ),
    },
    {
      id: "sku",
      header: "Артикул",
      sortable: true,
      sortValue: (row) => row.sku ?? "",
      cell: (row) => (
        <span className="text-muted-foreground">{row.sku ?? "—"}</span>
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

  columns.push(
    {
      id: "minStock",
      header: "Мин. остаток",
      sortable: true,
      sortValue: (row) => row.minStock ?? -1,
      className: "text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span className="text-muted-foreground">
          {formatQty(row.minStock)}
        </span>
      ),
    },
    {
      id: "stock",
      header: "Остаток",
      sortable: true,
      sortValue: (row) => row.stock,
      className: "text-right font-medium",
      headerClassName: "text-right",
      cell: (row) => formatQty(row.stock),
    },
  );

  if (canManage) {
    columns.push({
      id: "actions",
      header: "",
      className: "w-20",
      cell: (row) => (
        <div
          className="flex justify-end"
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label="Редактировать материал"
            onClick={() => openEdit(row)}
          >
            <Pencil className="size-4 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              row.active ? "Деактивировать материал" : "Активировать материал"
            }
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await toggleMaterial(row.id);
                if (result.ok) {
                  toast.success(
                    row.active
                      ? "Материал деактивирован"
                      : "Материал активирован",
                  );
                } else {
                  toast.error(result.error ?? "Ошибка");
                }
              })
            }
          >
            <Power className="size-4 text-muted-foreground" />
          </Button>
        </div>
      ),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Номенклатура</h1>
          <p className="text-sm text-muted-foreground">
            Клик по строке — просмотр карточки материала
          </p>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCategoriesOpen(true)}>
              <FolderPlus className="size-4" />
              Категории
            </Button>
            <Button ref={createButton} onClick={openCreate}>
              <Plus className="size-4" />
              Добавить материал
            </Button>
          </div>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        searchPlaceholder="Поиск по материалам…"
        emptyText="Материалов пока нет — добавьте первый"
        onRowClick={setViewing}
      />

      {/* Просмотр материала */}
      <Dialog
        open={!!viewing}
        onOpenChange={(open) => !open && setViewing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{viewing?.name ?? ""}</DialogTitle>
            <DialogDescription>Карточка материала</DialogDescription>
          </DialogHeader>
          {viewing ? (
            <div className="flex flex-col gap-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-muted-foreground">Артикул</div>
                  <div>{viewing.sku ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Категория</div>
                  <div>{viewing.categoryName ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Единица</div>
                  <div>{viewing.unit}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Мин. остаток</div>
                  <div>{formatQty(viewing.minStock)}</div>
                </div>
                {showMoney ? (
                  <div>
                    <div className="text-muted-foreground">Учётная цена</div>
                    <div>{formatAmount(viewing.purchasePrice, "BYN")}</div>
                  </div>
                ) : null}
                <div>
                  <div className="text-muted-foreground">Остаток</div>
                  <div
                    className={cn(
                      viewing.minStock !== null &&
                        viewing.stock < viewing.minStock &&
                        "font-medium text-red-600",
                    )}
                  >
                    {formatQty(viewing.stock)} {viewing.unit}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">
                    Не хватает по проектам
                  </div>
                  <div
                    className={cn(
                      viewing.shortByProjects > 0 &&
                        "font-medium text-red-600",
                    )}
                  >
                    {viewing.shortByProjects > 0
                      ? `${formatQty(viewing.shortByProjects)} ${viewing.unit}`
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Статус</div>
                  <div>{viewing.active ? "Активен" : "Неактивен"}</div>
                </div>
              </div>
              {viewing.comment ? (
                <div>
                  <div className="text-muted-foreground">Комментарий</div>
                  <div className="whitespace-pre-wrap">{viewing.comment}</div>
                </div>
              ) : null}
            </div>
          ) : null}
          {canManage ? (
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  if (viewing) {
                    setViewing(null);
                    openEdit(viewing);
                  }
                }}
              >
                <Pencil className="size-4" /> Редактировать
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <MaterialDialog open={editOpen} onOpenChange={setEditOpen} units={units} categories={categories} editing={editing} showAccountingPrice returnFocus={createButton} />

      {/* Категории материалов */}
      <Dialog open={categoriesOpen} onOpenChange={setCategoriesOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Категории</DialogTitle>
            <DialogDescription>
              Неактивная категория недоступна для выбора в материалах
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {categories.map((category) => (
              <div
                key={category.id}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5"
              >
                <span
                  className={cn(
                    !category.active &&
                      "text-muted-foreground line-through",
                  )}
                >
                  {category.name}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={
                    category.active
                      ? "Деактивировать категорию"
                      : "Активировать категорию"
                  }
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await toggleMaterialCategory(category.id);
                      if (result.ok) {
                        toast.success(
                          category.active
                            ? "Категория деактивирована"
                            : "Категория активирована",
                        );
                      } else {
                        toast.error(result.error ?? "Ошибка");
                      }
                    })
                  }
                >
                  <Power className="size-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
            {categories.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground">
                Категорий пока нет
              </div>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Input
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              placeholder="Новая категория…"
            />
            <Button
              disabled={pending || categoryName.trim() === ""}
              onClick={() =>
                startTransition(async () => {
                  const result = await addMaterialCategory({
                    name: categoryName.trim(),
                  });
                  if (result.ok) {
                    toast.success("Категория создана");
                    setCategoryName("");
                  } else {
                    toast.error(result.error ?? "Ошибка");
                  }
                })
              }
            >
              Добавить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
