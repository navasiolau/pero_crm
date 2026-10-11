"use client";

import { useState, useTransition } from "react";
import { LayoutGrid, Table2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  TaskDialog,
  taskStatusBadge,
  taskStatusLabels,
} from "@/components/task-dialog";
import type { TaskDetails } from "@/lib/task-details";
import { cn } from "@/lib/utils";
import { saveViewPreference } from "@/server/preferences-actions";

import { TasksKanban } from "./tasks-kanban";

// Раздел «Задачи»: канбан (по умолчанию) / таблица, выбор сохраняется (§7).
export function TasksPageView({
  tasks,
  actorUserId = "",
  canEdit,
  initialView,
  workers,
}: {
  tasks: TaskDetails[];
  actorUserId?: string;
  canEdit: boolean;
  initialView: "kanban" | "table";
  workers: { id: string; name: string; hint?: string }[];
}) {
  const [selected, setSelected] = useState<TaskDetails | null>(null);
  const [view, setView] = useState(initialView);
  const [, startTransition] = useTransition();

  const columns: DataColumn<TaskDetails>[] = [
    {
      id: "title",
      header: "Задача",
      sortable: true,
      sortValue: (row) => row.title,
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{row.title}</span>
          {row.type ? <Badge variant="outline">{row.type}</Badge> : null}
        </div>
      ),
    },
    {
      id: "project",
      header: "Проект",
      sortable: true,
      sortValue: (row) => `${row.projectNumber} ${row.projectTitle}`,
      cell: (row) => (
        <span className="text-muted-foreground">
          {row.projectNumber} · {row.projectTitle}
        </span>
      ),
    },
    {
      id: "product",
      header: "Изделие",
      sortable: true,
      sortValue: (row) => row.productNumber ?? "",
      cell: (row) => (
        <span className="text-muted-foreground">
          {row.productNumber
            ? `${row.productNumber}${row.productTitle ? ` · ${row.productTitle}` : ""}`
            : "—"}
        </span>
      ),
    },
    {
      id: "assignee",
      header: "Исполнитель",
      sortable: true,
      sortValue: (row) => row.assigneeName ?? "",
      cell: (row) => row.assigneeName ?? "—",
    },
    {
      id: "due",
      header: "Срок",
      sortable: true,
      sortValue: (row) => row.dueAt ?? "",
      cell: (row) =>
        row.dueAt ? new Date(row.dueAt).toLocaleDateString("ru-RU") : "—",
    },
    {
      id: "status",
      header: "Статус",
      sortable: true,
      sortValue: (row) => taskStatusLabels[row.status],
      cell: (row) => (
        <Badge
          variant="outline"
          className={cn("border-transparent", taskStatusBadge[row.status])}
        >
          {taskStatusLabels[row.status]}
        </Badge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Задачи</h1>
          <p className="text-sm text-muted-foreground">
            Клик по задаче — просмотр{canEdit ? " и редактирование" : ""};
            на канбане статус меняется перетаскиванием
          </p>
        </div>
        <ToggleGroup
          value={[view]}
          onValueChange={(value) => {
            const next = value[0] as "kanban" | "table" | undefined;
            if (!next) return;
            setView(next);
            startTransition(async () => {
              await saveViewPreference("tasks.view", next);
            });
          }}
        >
          <ToggleGroupItem value="kanban" aria-label="Канбан">
            <LayoutGrid className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="table" aria-label="Таблица">
            <Table2 className="size-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {view === "kanban" ? (
        <TasksKanban
          actorUserId={actorUserId}
          initialTasks={tasks}
          canManage={canEdit}
          onOpen={setSelected}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={tasks}
          searchPlaceholder="Поиск задачи…"
          onRowClick={setSelected}
        />
      )}

      <TaskDialog
        task={selected}
        workers={workers}
        canEdit={canEdit}
        projectTasks={tasks
          .filter((task) => task.projectId === selected?.projectId)
          .map((task) => ({ id: task.id, title: task.title, status: task.status }))}
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}
