"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatAmount } from "@/lib/format";
import {
  createPriceItem,
  togglePriceItem,
  updatePriceItem,
} from "@/server/prices/actions";

interface PriceRow {
  id: string;
  name: string;
  unit: string;
  price: string;
  category: string | null;
  active: boolean;
}

const UNITS = ["шт", "м²", "м.п.", "компл", "час", "услуга"];

const emptyForm = { name: "", unit: "шт", price: "", category: "" };

// Прайсы (§9): расценки, управление менеджером/админом/директором,
// любое изменение — в журнал изменений.
export function PricesView({
  items,
  canManage,
}: {
  items: PriceRow[];
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PriceRow | null>(null);
  const [form, setForm] = useState(emptyForm);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(item: PriceRow) {
    setEditing(item);
    setForm({
      name: item.name,
      unit: item.unit,
      price: item.price,
      category: item.category ?? "",
    });
    setOpen(true);
  }

  const price = Number(form.price);
  const valid =
    form.name.trim().length > 0 && !Number.isNaN(price) && price > 0;

  const columns: DataColumn<PriceRow>[] = [
    {
      id: "name",
      header: "Расценка",
      sortable: true,
      sortValue: (row) => row.name,
      searchValue: (row) => `${row.name} ${row.category ?? ""}`,
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.name}</span>
          {row.category ? (
            <span className="text-xs text-muted-foreground">{row.category}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: "unit",
      header: "Единица",
      sortable: true,
      sortValue: (row) => row.unit,
      cell: (row) => row.unit,
    },
    {
      id: "price",
      header: "Цена",
      sortable: true,
      sortValue: (row) => Number(row.price),
      headerClassName: "text-right",
      className: "text-right",
      cell: (row) => formatAmount(row.price, "BYN"),
    },
    {
      id: "active",
      header: "Активна",
      sortable: true,
      sortValue: (row) => (row.active ? "да" : "нет"),
      cell: (row) =>
        canManage ? (
          <div onClick={(event) => event.stopPropagation()}>
            <Switch
              checked={row.active}
              disabled={pending}
              onCheckedChange={(checked) =>
                startTransition(async () => {
                  const result = await togglePriceItem(row.id, checked);
                  if (!result.ok) toast.error(result.error ?? "Ошибка");
                })
              }
            />
          </div>
        ) : row.active ? (
          <Badge variant="secondary">да</Badge>
        ) : (
          <Badge variant="outline">нет</Badge>
        ),
    },
    ...(canManage
      ? [
          {
            id: "actions",
            header: "",
            cell: (row: PriceRow) => (
              <div
                className="text-right"
                onClick={(event) => event.stopPropagation()}
              >
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Редактировать"
                  onClick={() => openEdit(row)}
                >
                  <Pencil className="size-4" />
                </Button>
              </div>
            ),
          } satisfies DataColumn<PriceRow>,
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Прайсы</h1>
          <p className="text-sm text-muted-foreground">
            Расценки на работы. Цена фиксируется в работе на момент назначения —
            изменение прайса не переписывает прошлое.
          </p>
        </div>
        {canManage ? (
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Расценка
          </Button>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={items}
        searchPlaceholder="Поиск расценки…"
        onRowClick={canManage ? openEdit : undefined}
        emptyText="Расценок пока нет"
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Редактировать расценку" : "Новая расценка"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-name">Название *</Label>
              <Input
                id="p-name"
                value={form.name}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="Распил ЛДСП, кромление, сборка…"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Единица</Label>
                <Select
                  value={form.unit}
                  onValueChange={(value) =>
                    setForm((prev) => ({ ...prev, unit: value ?? "шт" }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue>{form.unit}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {UNITS.map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {unit}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="p-price">Цена, BYN *</Label>
                <Input
                  id="p-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, price: event.target.value }))
                  }
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="p-category">Категория</Label>
              <Input
                id="p-category"
                value={form.category}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, category: event.target.value }))
                }
                placeholder="Корпус, фасады, монтаж…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={!valid || pending}
              onClick={() =>
                startTransition(async () => {
                  const payload = {
                    name: form.name.trim(),
                    unit: form.unit,
                    price,
                    category: form.category.trim() || undefined,
                  };
                  const result = editing
                    ? await updatePriceItem(editing.id, payload)
                    : await createPriceItem(payload);
                  if (result.ok) {
                    toast.success(editing ? "Сохранено" : "Расценка создана");
                    setOpen(false);
                  } else {
                    toast.error(result.error ?? "Ошибка");
                  }
                })
              }
            >
              {editing ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
