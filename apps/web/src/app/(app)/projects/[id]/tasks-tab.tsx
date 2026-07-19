"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Play, Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
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
import {
  TaskDialog,
  TASK_TYPES,
  taskStatusBadge,
  taskStatusLabels,
  type TaskDetails,
} from "@/components/task-dialog";
import { cn } from "@/lib/utils";
import { changeTaskStatus, createTask } from "@/server/tasks/actions";

import type { SelectOption } from "../projects-view";

function tomorrow(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Вкладка «Работы и задачи». Клик по задаче — карточка (просмотр/правка).
// Замер = типовая задача с обязательными фото (§6.2).
export function TasksTab({
  projectId,
  tasks,
  canManage,
  workers,
}: {
  projectId: string;
  tasks: TaskDetails[];
  canManage: boolean;
  workers: SelectOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<TaskDetails | null>(null);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("Производство");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueAt, setDueAt] = useState(tomorrow);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  function uploadFile(taskId: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("projectId", projectId);
    form.append("taskId", taskId);
    form.append("category", "MEASUREMENT");
    startTransition(async () => {
      const response = await fetch("/api/files/upload", {
        method: "POST",
        body: form,
      });
      if (response.ok) {
        toast.success("Фото приложено");
        router.refresh();
      } else {
        const data = await response.json().catch(() => ({}));
        toast.error(data.error ?? "Ошибка загрузки");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between">
        <p className="text-sm text-muted-foreground">
          Клик по задаче — просмотр{canManage ? " и редактирование" : ""}.
          Замер требует фото при выполнении (§6.2).
        </p>
        {canManage ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-4" /> Задача
          </Button>
        ) : null}
      </div>

      {tasks.map((task) => (
        <Card
          key={task.id}
          className="cursor-pointer transition-colors hover:bg-accent/50"
          onClick={() => setSelected(task)}
        >
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-40 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{task.title}</span>
                {task.type ? <Badge variant="outline">{task.type}</Badge> : null}
                {task.status === "DRAFT" ? (
                  <Badge
                    variant="outline"
                    className={cn("border-transparent", taskStatusBadge.DRAFT)}
                  >
                    Черновик
                  </Badge>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground">
                {task.assigneeName ?? "без исполнителя"}
                {task.dueAt
                  ? ` · до ${new Date(task.dueAt).toLocaleDateString("ru-RU")}`
                  : ""}
              </div>
            </div>
            <Badge
              variant="outline"
              className={cn("border-transparent", taskStatusBadge[task.status])}
            >
              {taskStatusLabels[task.status]}
            </Badge>
            <div
              className="flex items-center gap-2"
              onClick={(event) => event.stopPropagation()}
            >
              {task.status === "NEW" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await changeTaskStatus(task.id, "IN_PROGRESS");
                      if (!result.ok) toast.error(result.error ?? "Ошибка");
                    })
                  }
                >
                  <Play className="size-4" /> В работу
                </Button>
              ) : null}
              {task.status === "NEW" || task.status === "IN_PROGRESS" ? (
                <>
                  {task.requiresPhoto ? (
                    <>
                      <input
                        ref={(el) => {
                          fileInputs.current[task.id] = el;
                        }}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) uploadFile(task.id, file);
                          event.target.value = "";
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => fileInputs.current[task.id]?.click()}
                      >
                        <Camera className="size-4" /> Фото
                      </Button>
                    </>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await changeTaskStatus(task.id, "DONE");
                        if (result.ok) {
                          toast.success("Задача выполнена");
                        } else {
                          toast.error(result.error ?? "Ошибка");
                        }
                      })
                    }
                  >
                    <Check className="size-4" /> Выполнена
                  </Button>
                </>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}
      {tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Задач пока нет
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая задача</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-title">Название *</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Например: Замер на объекте"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Тип *</Label>
                <Select
                  value={type}
                  onValueChange={(value) => setType(value ?? "Производство")}
                >
                  <SelectTrigger>
                    <SelectValue>{type}</SelectValue>
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
                  value={assigneeId}
                  onChange={setAssigneeId}
                  placeholder="не назначен — черновик"
                  searchPlaceholder="Поиск сотрудника…"
                  allowClear
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="due">Срок *</Label>
              <Input
                id="due"
                type="date"
                required
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </div>
            {!assigneeId ? (
              <p className="text-xs text-muted-foreground">
                Без исполнителя задача создаётся черновиком — будет подписана
                значком «Черновик», пока исполнителя не выберут.
              </p>
            ) : null}
            {type === "Замер" ? (
              <p className="text-xs text-muted-foreground">
                Замер (§6.2): при выполнении система потребует приложить
                фото/замерный лист — файлы попадут в проект с категорией
                «Замер».
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={!title.trim() || !type || !dueAt || pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await createTask({
                    projectId,
                    title: title.trim(),
                    type,
                    assigneeId: assigneeId || undefined,
                    dueAt,
                    requiresPhoto: type === "Замер",
                  });
                  if (result.ok) {
                    toast.success("Задача создана");
                    setOpen(false);
                    setTitle("");
                    setType("Производство");
                    setAssigneeId("");
                    setDueAt(tomorrow());
                    router.refresh();
                  } else {
                    toast.error(result.error ?? "Ошибка");
                  }
                })
              }
            >
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TaskDialog
        task={selected}
        workers={workers}
        canEdit={canManage}
        open={!!selected}
        onOpenChange={(next) => !next && setSelected(null)}
      />
    </div>
  );
}
