"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import type { PayScheme, Role } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { roleLabels } from "@/lib/nav";
import { createUser, updateUser } from "@/server/users/actions";

interface UserRow {
  id: string;
  email: string;
  name: string;
  position: string | null;
  phone: string | null;
  telegram: string | null;
  role: Role;
  payScheme: PayScheme;
  payPercent: string | null;
  active: boolean;
}

const paySchemeLabels: Record<PayScheme, string> = {
  PIECE: "Сдельная",
  PERCENT_PROJECT: "% от стоимости",
  PERCENT_TURNOVER: "% от оборота",
  NONE: "Без расчёта",
};

const emptyForm = {
  email: "",
  name: "",
  position: "",
  phone: "",
  telegram: "",
  role: "WORKER" as Role,
  payScheme: "PIECE" as PayScheme,
  payPercent: "",
  active: true,
  password: "",
};

// Управление сотрудниками: ФИО, должность, телефон, telegram (§4).
// Действия в журнале привязываются к конкретному человеку, а не к роли.
export function UsersView({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [form, setForm] = useState(emptyForm);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(user: UserRow) {
    setEditing(user);
    setForm({
      email: user.email,
      name: user.name,
      position: user.position ?? "",
      phone: user.phone ?? "",
      telegram: user.telegram ?? "",
      role: user.role,
      payScheme: user.payScheme,
      payPercent: user.payPercent ?? "",
      active: user.active,
      password: "",
    });
    setOpen(true);
  }

  function set<K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const valid =
    form.email.includes("@") &&
    form.name.trim().length > 0 &&
    (editing ? true : form.password.length >= 8);

  const columns: DataColumn<UserRow>[] = [
    {
      id: "name",
      header: "ФИО",
      sortable: true,
      sortValue: (row) => row.name,
      searchValue: (row) => `${row.name} ${row.email}`,
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">
            {row.name}
            {row.id === currentUserId ? " (вы)" : ""}
          </span>
          <span className="text-xs text-muted-foreground">{row.email}</span>
        </div>
      ),
    },
    {
      id: "position",
      header: "Должность",
      sortable: true,
      sortValue: (row) => row.position ?? "",
      cell: (row) => row.position ?? "—",
    },
    {
      id: "role",
      header: "Роль",
      sortable: true,
      sortValue: (row) => roleLabels[row.role],
      cell: (row) => <Badge variant="outline">{roleLabels[row.role]}</Badge>,
    },
    {
      id: "phone",
      header: "Телефон",
      sortValue: (row) => row.phone ?? "",
      cell: (row) => <span className="text-muted-foreground">{row.phone ?? "—"}</span>,
    },
    {
      id: "telegram",
      header: "Telegram",
      sortValue: (row) => row.telegram ?? "",
      cell: (row) => <span className="text-muted-foreground">{row.telegram ?? "—"}</span>,
    },
    {
      id: "pay",
      header: "Оплата",
      sortable: true,
      sortValue: (row) => paySchemeLabels[row.payScheme],
      cell: (row) => (
        <span className="text-muted-foreground">
          {paySchemeLabels[row.payScheme]}
          {row.payPercent ? ` ${row.payPercent}%` : ""}
        </span>
      ),
    },
    {
      id: "status",
      header: "Статус",
      sortable: true,
      sortValue: (row) => (row.active ? "активен" : "отключён"),
      cell: (row) =>
        row.active ? (
          <Badge variant="secondary">активен</Badge>
        ) : (
          <Badge variant="destructive">отключён</Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      cell: (row) => (
        <div className="text-right">
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
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Пользователи</h1>
          <p className="text-sm text-muted-foreground">
            Сотрудники организации: ФИО, должность, контакты, роль и схема
            оплаты
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4" /> Сотрудник
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={users.map((user) => ({
          ...user,
          // неактивные — внизу, визуально приглушены через прозрачность строки
        }))}
        searchPlaceholder="Поиск сотрудника…"
        onRowClick={openEdit}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Редактировать сотрудника" : "Новый сотрудник"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="u-name">ФИО *</Label>
              <Input
                id="u-name"
                value={form.name}
                onChange={(event) => set("name", event.target.value)}
                placeholder="Иванов Иван Иванович"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="u-email">Email *</Label>
                <Input
                  id="u-email"
                  type="email"
                  value={form.email}
                  onChange={(event) => set("email", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="u-position">Должность</Label>
                <Input
                  id="u-position"
                  value={form.position}
                  onChange={(event) => set("position", event.target.value)}
                  placeholder="Столяр, монтажник…"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="u-phone">Телефон</Label>
                <Input
                  id="u-phone"
                  value={form.phone}
                  onChange={(event) => set("phone", event.target.value)}
                  placeholder="+375 29 …"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="u-telegram">Telegram</Label>
                <Input
                  id="u-telegram"
                  value={form.telegram}
                  onChange={(event) => set("telegram", event.target.value)}
                  placeholder="@username"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Роль</Label>
                <Select
                  value={form.role}
                  onValueChange={(value) => set("role", (value ?? "WORKER") as Role)}
                >
                  <SelectTrigger>
                    <SelectValue>{roleLabels[form.role]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(roleLabels).map(([id, label]) => (
                      <SelectItem key={id} value={id}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Схема оплаты</Label>
                <Select
                  value={form.payScheme}
                  onValueChange={(value) =>
                    set("payScheme", (value ?? "NONE") as PayScheme)
                  }
                >
                  <SelectTrigger>
                    <SelectValue>{paySchemeLabels[form.payScheme]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(paySchemeLabels).map(([id, label]) => (
                      <SelectItem key={id} value={id}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.payScheme === "PERCENT_PROJECT" ||
            form.payScheme === "PERCENT_TURNOVER" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="u-percent">Размер процента</Label>
                <Input
                  id="u-percent"
                  type="number"
                  min="0"
                  max="100"
                  value={form.payPercent}
                  onChange={(event) => set("payPercent", event.target.value)}
                />
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="u-password">
                {editing ? "Новый пароль (пусто — не менять)" : "Пароль * (мин. 8)"}
              </Label>
              <Input
                id="u-password"
                type="password"
                value={form.password}
                onChange={(event) => set("password", event.target.value)}
                autoComplete="new-password"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.active}
                onCheckedChange={(checked) => set("active", checked === true)}
              />
              Учётная запись активна
            </label>
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
                    email: form.email.trim(),
                    name: form.name.trim(),
                    position: form.position.trim() || undefined,
                    phone: form.phone.trim() || undefined,
                    telegram: form.telegram.trim() || undefined,
                    role: form.role,
                    payScheme: form.payScheme,
                    payPercent:
                      form.payPercent.trim() === ""
                        ? null
                        : Number(form.payPercent),
                    active: form.active,
                    password: form.password || undefined,
                  };
                  const result = editing
                    ? await updateUser(editing.id, payload)
                    : await createUser(payload);
                  if (result.ok) {
                    toast.success(editing ? "Сохранено" : "Сотрудник создан");
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
