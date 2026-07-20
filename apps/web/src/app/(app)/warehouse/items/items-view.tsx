"use client";

import { useMemo, useState, useTransition } from "react";
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
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatAmount, formatQty } from "@/lib/format";
import { MATERIAL_UNITS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import {
  addMaterial,
  addMaterialCategory,
  toggleMaterial,
  toggleMaterialCategory,
  updateMaterial,
} from "@/server/warehouse/actions";
import type {
  MaterialCategoryView,
  MaterialView,
} from "@/server/warehouse/queries";

const emptyForm = {
  name: "",
  sku: "",
  categoryId: "",
  unit: "шт",
  purchasePrice: "",
  minStock: "",
  comment: "",
};

// Номенклатура склада: материалы с остатками, категории, учётные цены.
// Материал/категория с историей не удаляются — деактивируются (иконка Power).
export function ItemsView({
  rows,
  categories,
  canManage,
  showMoney,
}: {
  rows: MaterialView[];
  categories: MaterialCategoryView[];
  canManage: boolean;
  showMoney: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<MaterialView | null>(null);
  const [viewing, setViewing] = useState<MaterialView | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [form, setForm] = useState(emptyForm);

  // В выбор — только активные категории (сервер отклонит неактивную)
  const categoryOptions = useMemo(
    () =>
      categories
        .filter((category) => category.active)
        .map((category) => ({ value: category.id, label: category.name })),
    [categories],
  );

  function set(key: keyof typeof emptyForm) {
    return (event: { target: { value: string } }) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }));
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setEditOpen(true);
  }

  function openEdit(material: MaterialView) {
    setEditing(material);
    setForm({
      name: material.name,
      sku: material.sku ?? "",
      categoryId: material.categoryId ?? "",
      unit: material.unit,
      purchasePrice:
        material.purchasePrice === null ? "" : String(material.purchasePrice),
      minStock: material.minStock === null ? "" : String(material.minStock),
      comment: material.comment ?? "",
    });
    setEditOpen(true);
  }

  const price = Number(form.purchasePrice);
  const minStock = Number(form.minStock);
  const formValid =
    form.name.trim() !== "" &&
    (form.purchasePrice.trim() === "" ||
      (Number.isFinite(price) && price >= 0)) &&
    (form.minStock.trim() === "" ||
      (Number.isFinite(minStock) && minStock >= 0));

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
            <Button onClick={openCreate}>
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

      {/* Создание / редактирование материала */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Редактировать материал" : "Новый материал"}
            </DialogTitle>
            <DialogDescription>
              Учётная цена и минимальный остаток — необязательны
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="m-name">Название *</Label>
              <Input
                id="m-name"
                value={form.name}
                onChange={set("name")}
                placeholder="ЛДСП 16 мм, Кромка ПВХ…"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="m-sku">Артикул</Label>
                <Input id="m-sku" value={form.sku} onChange={set("sku")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Категория</Label>
                <SearchableSelect
                  options={categoryOptions}
                  value={form.categoryId}
                  onChange={(value) =>
                    setForm((prev) => ({ ...prev, categoryId: value }))
                  }
                  placeholder="Без категории"
                  searchPlaceholder="Поиск категории…"
                  emptyText="Категория не найдена"
                  allowClear
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Единица *</Label>
                <Select
                  value={form.unit}
                  onValueChange={(next) =>
                    setForm((prev) => ({ ...prev, unit: next ?? "шт" }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue>{form.unit}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {MATERIAL_UNITS.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {unit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="m-price">Учётная цена, BYN</Label>
                <Input
                  id="m-price"
                  inputMode="decimal"
                  value={form.purchasePrice}
                  onChange={set("purchasePrice")}
                  placeholder="0"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="m-min">Мин. остаток</Label>
                <Input
                  id="m-min"
                  inputMode="decimal"
                  value={form.minStock}
                  onChange={set("minStock")}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="m-comment">Комментарий</Label>
              <Input
                id="m-comment"
                value={form.comment}
                onChange={set("comment")}
                placeholder="Необязательно"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={pending || !formValid}
              onClick={() =>
                startTransition(async () => {
                  const payload = {
                    name: form.name.trim(),
                    sku: form.sku.trim() || undefined,
                    unit: form.unit,
                    categoryId: form.categoryId || undefined,
                    purchasePrice:
                      form.purchasePrice.trim() === "" ? undefined : price,
                    minStock:
                      form.minStock.trim() === "" ? undefined : minStock,
                    comment: form.comment.trim() || undefined,
                  };
                  const result = editing
                    ? await updateMaterial(editing.id, payload)
                    : await addMaterial(payload);
                  if (result.ok) {
                    toast.success(editing ? "Сохранено" : "Материал создан");
                    setEditOpen(false);
                  } else {
                    toast.error(result.error ?? "Ошибка");
                  }
                })
              }
            >
              {pending ? "Сохранение…" : editing ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
