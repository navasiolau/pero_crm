"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import type { TaskStatus } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useFileViewer } from "@/components/file-viewer";
import { cn } from "@/lib/utils";
import { updateTask } from "@/server/tasks/actions";

export interface TaskDetails {
  id: string;
  title: string;
  type: string | null;
  status: TaskStatus;
  dueAt: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  requiresPhoto: boolean;
  projectId: string;
  projectNumber: string;
  projectTitle: string;
  files: { id: string; fileName: string; hasThumb: boolean; mimeType: string }[];
  createdAt: string;
  doneAt: string | null;
  doneByName: string | null;
  createdByName: string | null;
}

export const TASK_TYPES = ["Замер", "Производство", "Доставка", "Монтаж", "Прочее"];

export const taskStatusLabels: Record<TaskStatus, string> = {
  DRAFT: "Черновик",
  NEW: "Новая",
  IN_PROGRESS: "В работе",
  DONE: "Выполнена",
};

export const taskStatusBadge: Record<TaskStatus, string> = {
  DRAFT: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
  NEW: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  IN_PROGRESS: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  DONE: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

// Карточка задачи (клик по задаче в проекте или в разделе «Задачи»).
// Админ/менеджер — просмотр + редактирование; выполненная — только просмотр.
export function TaskDialog({
  task,
  workers,
  canEdit,
  open,
  onOpenChange,
}: {
  task: TaskDetails | null;
  workers: { id: string; name: string; hint?: string }[];
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const fileViewer = useFileViewer();
  const [form, setForm] = useState({
    title: "",
    type: "Производство",
    assigneeId: "",
    dueAt: "",
  });

  if (!task) return null;
  const readOnly = task.status === "DONE" || !canEdit;

  function startEdit() {
    if (!task) return;
    setForm({
      title: task.title,
      type: task.type ?? "Производство",
      assigneeId: task.assigneeId ?? "",
      dueAt: task.dueAt ? task.dueAt.slice(0, 10) : "",
    });
    setEditing(true);
  }

  const valid = form.title.trim() && form.type && form.dueAt;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setEditing(false);
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editing ? "Редактирование задачи" : task.title}
            <Badge
              variant="outline"
              className={cn("border-transparent", taskStatusBadge[task.status])}
            >
              {taskStatusLabels[task.status]}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            <Link
              href={`/projects/${task.projectId}`}
              className="underline-offset-2 hover:underline"
            >
              {task.projectNumber} · {task.projectTitle}
            </Link>
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="td-title">Название *</Label>
              <Input
                id="td-title"
                value={form.title}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, title: event.target.value }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Тип *</Label>
                <Select
                  value={form.type}
                  onValueChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      type: value ?? "Производство",
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue>{form.type}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_TYPES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Исполнитель</Label>
                <SearchableSelect
                  options={workers.map((worker) => ({
                    value: worker.id,
                    label: worker.name,
                    hint: worker.hint,
                  }))}
                  value={form.assigneeId}
                  onChange={(value) =>
                    setForm((prev) => ({ ...prev, assigneeId: value }))
                  }
                  placeholder="не назначен — черновик"
                  searchPlaceholder="Поиск сотрудника…"
                  allowClear
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="td-due">Срок *</Label>
              <Input
                id="td-due"
                type="date"
                required
                value={form.dueAt}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, dueAt: event.target.value }))
                }
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              <div>
                <div className="text-xs text-muted-foreground">Тип</div>
                <div>{task.type ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Срок</div>
                <div>
                  {task.dueAt
                    ? new Date(task.dueAt).toLocaleDateString("ru-RU")
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Исполнитель</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {task.assigneeName ?? "не назначен"}
                  {!task.assigneeName ? (
                    <Badge
                      variant="outline"
                      className={cn("border-transparent", taskStatusBadge.DRAFT)}
                    >
                      Черновик
                    </Badge>
                  ) : null}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Создатель задачи</div>
                <div>{task.createdByName ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Создана</div>
                <div>{new Date(task.createdAt).toLocaleDateString("ru-RU")}</div>
              </div>
            </div>
            {task.status === "DONE" ? (
              <div className="rounded-lg bg-emerald-500/10 p-2.5 text-emerald-700 dark:text-emerald-400">
                Выполнена {task.doneAt
                  ? new Date(task.doneAt).toLocaleString("ru-RU")
                  : ""}
                {task.doneByName ? ` · ${task.doneByName}` : ""}
              </div>
            ) : null}
            {task.requiresPhoto ? (
              <div className="text-muted-foreground">
                Замер: фото обязательны при выполнении (§6.2)
              </div>
            ) : null}
            {task.files.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-muted-foreground">
                  Файлы ({task.files.length}) — клик открывает просмотр:
                </span>
                <div className="flex flex-wrap gap-2">
                  {task.files.map((file) =>
                    file.hasThumb ? (
                      <button
                        key={file.id}
                        type="button"
                        onClick={() => fileViewer.open(file)}
                        title="Открыть на просмотр"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/files/${file.id}?thumb=1`}
                          alt={file.fileName}
                          className="size-20 rounded-lg border object-cover transition-transform hover:scale-105"
                        />
                      </button>
                    ) : (
                      <button
                        key={file.id}
                        type="button"
                        onClick={() => fileViewer.open(file)}
                        className="rounded-lg border px-2 py-1 text-xs underline-offset-2 hover:underline"
                      >
                        {file.fileName}
                      </button>
                    ),
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {editing ? (
            <>
              <Button variant="outline" onClick={() => setEditing(false)}>
                Отмена
              </Button>
              <Button
                disabled={!valid || pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await updateTask(task.id, {
                      title: form.title.trim(),
                      type: form.type,
                      assigneeId: form.assigneeId || null,
                      dueAt: form.dueAt,
                    });
                    if (result.ok) {
                      toast.success("Задача обновлена");
                      setEditing(false);
                      onOpenChange(false);
                      router.refresh();
                    } else {
                      toast.error(result.error ?? "Ошибка");
                    }
                  })
                }
              >
                {pending ? "Сохранение…" : "Сохранить"}
              </Button>
            </>
          ) : (
            !readOnly && (
              <Button variant="outline" onClick={startEdit}>
                <Pencil className="size-4" /> Редактировать
              </Button>
            )
          )}
        </DialogFooter>
      </DialogContent>
      {fileViewer.viewer}
    </Dialog>
  );
}
