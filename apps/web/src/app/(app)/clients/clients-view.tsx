"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { displayClientName } from "@/lib/labels";
import { createClient, updateClient } from "@/server/clients/actions";

interface ClientRow {
  id: string;
  name: string;
  lastName: string | null;
  middleName: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  comment: string | null;
  projects: { id: string; number: string; title: string }[];
  projectsCount: number;
}

const emptyForm = {
  name: "",
  lastName: "",
  middleName: "",
  phone: "",
  email: "",
  address: "",
  comment: "",
};

// Справочник клиентов: таблица с поиском/сортировкой/пагинацией,
// окно просмотра по клику (в таблице — не вся информация), создание/редактирование.
// focusClientId — открыть карточку сразу (ссылки из карточек изделий).
export function ClientsView({
  clients,
  focusClientId,
  canManage,
}: {
  clients: ClientRow[];
  focusClientId?: string;
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [viewing, setViewing] = useState<ClientRow | null>(
    focusClientId ? (clients.find((c) => c.id === focusClientId) ?? null) : null,
  );
  const [form, setForm] = useState(emptyForm);

  function openCreate() {
    if (!canManage) return;
    setEditing(null);
    setForm(emptyForm);
    setEditOpen(true);
  }

  function openEdit(client: ClientRow) {
    if (!canManage) return;
    setEditing(client);
    setForm({
      name: client.name,
      lastName: client.lastName ?? "",
      middleName: client.middleName ?? "",
      phone: client.phone,
      email: client.email ?? "",
      address: client.address ?? "",
      comment: client.comment ?? "",
    });
    setEditOpen(true);
  }

  function set(key: keyof typeof emptyForm) {
    return (event: { target: { value: string } }) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }));
  }

  const valid = form.name.trim() && form.phone.trim();

  const columns: DataColumn<ClientRow>[] = [
    {
      id: "name",
      header: "Клиент",
      sortable: true,
      sortValue: (row) => displayClientName(row),
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{displayClientName(row)}</span>
          <span className="text-xs text-muted-foreground">{row.email ?? ""}</span>
        </div>
      ),
    },
    {
      id: "phone",
      header: "Телефон",
      sortable: true,
      sortValue: (row) => row.phone,
      cell: (row) => row.phone,
    },
    {
      id: "address",
      header: "Адрес",
      sortValue: (row) => row.address ?? "",
      cell: (row) => (
        <span className="text-muted-foreground">{row.address ?? "—"}</span>
      ),
    },
    {
      id: "projects",
      header: "Проектов",
      sortable: true,
      sortValue: (row) => row.projectsCount,
      headerClassName: "text-right",
      className: "text-right",
      cell: (row) => row.projectsCount,
    },
    {
      id: "actions",
      header: "",
      sortValue: () => "",
      cell: (row) => canManage ? (
        <div className="text-right" onClick={(event) => event.stopPropagation()}>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Редактировать"
            onClick={() => openEdit(row)}
          >
            <Pencil className="size-4" />
          </Button>
        </div>
      ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Клиенты</h1>
          <p className="text-sm text-muted-foreground">
            Клик по строке — просмотр карточки клиента
          </p>
        </div>
        {canManage ? <Button onClick={openCreate}>
          <Plus className="size-4" /> Клиент
        </Button> : null}
      </div>

      <DataTable
        columns={columns}
        rows={clients}
        searchPlaceholder="Поиск клиента…"
        onRowClick={setViewing}
      />

      {/* Просмотр клиента */}
      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{viewing ? displayClientName(viewing) : ""}</DialogTitle>
            <DialogDescription>Карточка клиента</DialogDescription>
          </DialogHeader>
          {viewing ? (
            <div className="flex flex-col gap-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-muted-foreground">Телефон</div>
                  <div>{viewing.phone}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Email</div>
                  <div>{viewing.email ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Адрес</div>
                  <div>{viewing.address ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Проектов</div>
                  <div>{viewing.projectsCount}</div>
                </div>
              </div>
              {viewing.comment ? (
                <div>
                  <div className="text-muted-foreground">Комментарий</div>
                  <div className="whitespace-pre-wrap">{viewing.comment}</div>
                </div>
              ) : null}
              {viewing.projects.length > 0 ? (
                <div>
                  <div className="mb-1 text-muted-foreground">Проекты</div>
                  <div className="flex flex-col gap-1">
                    {viewing.projects.map((project) => (
                      <Link
                        key={project.id}
                        href={`/projects/${project.id}`}
                        className="rounded-lg border px-2 py-1.5 hover:bg-accent"
                      >
                        {project.number} · {project.title}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            {canManage ? <Button
              variant="outline"
              onClick={() => {
                if (viewing) {
                  setViewing(null);
                  openEdit(viewing);
                }
              }}
            >
              <Pencil className="size-4" /> Редактировать
            </Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Создание / редактирование */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Редактировать клиента" : "Новый клиент"}
            </DialogTitle>
            <DialogDescription>
              Для юрлица название пишем в поле «Имя» — например, «ООО Альфа».
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-lastName">Фамилия</Label>
                <Input
                  id="c-lastName"
                  value={form.lastName}
                  onChange={set("lastName")}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-name">Имя *</Label>
                <Input id="c-name" value={form.name} onChange={set("name")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-middleName">Отчество</Label>
                <Input
                  id="c-middleName"
                  value={form.middleName}
                  onChange={set("middleName")}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-phone">Телефон *</Label>
                <Input id="c-phone" value={form.phone} onChange={set("phone")} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="c-email">Email</Label>
                <Input id="c-email" value={form.email} onChange={set("email")} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-address">Адрес</Label>
              <Input id="c-address" value={form.address} onChange={set("address")} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-comment">Комментарий</Label>
              <Textarea id="c-comment" value={form.comment} onChange={set("comment")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={!valid || pending}
              onClick={() =>
                startTransition(async () => {
                  const payload = {
                    name: form.name.trim(),
                    lastName: form.lastName.trim() || undefined,
                    middleName: form.middleName.trim() || undefined,
                    phone: form.phone.trim(),
                    email: form.email.trim() || undefined,
                    address: form.address.trim() || undefined,
                    comment: form.comment.trim() || undefined,
                  };
                  const result = editing
                    ? await updateClient(editing.id, payload, { name: editing.name, lastName: editing.lastName, middleName: editing.middleName, phone: editing.phone, email: editing.email, address: editing.address, comment: editing.comment })
                    : await createClient(payload);
                  if (result.ok) {
                    toast.success(editing ? "Сохранено" : "Клиент создан");
                    setEditOpen(false);
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
