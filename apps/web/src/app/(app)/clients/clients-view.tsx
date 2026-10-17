"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";

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
import {ClientDialog} from "@/components/client-dialog";
import { displayClientName } from "@/lib/labels";
import type { ClientBaseline } from "@/server/clients/core";
import type { ClientDirectoryRow } from "@/server/clients/queries";

type ClientRow = ClientDirectoryRow;
type Editing = ClientBaseline & { id: string };


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
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [viewing, setViewing] = useState<ClientRow | null>(
    focusClientId ? (clients.find((c) => c.id === focusClientId) ?? null) : null,
  );

  function openCreate() {
    if (!canManage) return;
    setEditing(null);
    setEditOpen(true);
  }

  function openEdit(client: ClientRow) {
    if (!canManage || client.passportNumber === undefined || client.passportIssuedBy === undefined) return;
    setEditing({ ...client, passportNumber: client.passportNumber, passportIssuedBy: client.passportIssuedBy });
    setEditOpen(true);
  }


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
                {canManage && viewing.passportNumber !== undefined ? (
                  <div className="min-w-0">
                    <div className="text-muted-foreground">Номер паспорта</div>
                    <div className="break-words">{viewing.passportNumber ?? "—"}</div>
                  </div>
                ) : null}
                {canManage && viewing.passportIssuedBy !== undefined ? (
                  <div className="col-span-2 min-w-0">
                    <div className="text-muted-foreground">Кем выдан</div>
                    <div className="whitespace-pre-wrap break-words">{viewing.passportIssuedBy ?? "—"}</div>
                  </div>
                ) : null}
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

      <ClientDialog open={editOpen} onOpenChange={setEditOpen} editing={editing} />
    </div>
  );
}
