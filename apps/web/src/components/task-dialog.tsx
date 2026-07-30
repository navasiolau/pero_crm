"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
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
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { QuantityStepper } from "@/components/quantity-stepper";
import { cn } from "@/lib/utils";
import { deleteTask, updateTask } from "@/server/tasks/actions";
import { fetchProductOptions } from "@/server/products/actions";

export interface TaskDetails {
  id: string;
  title: string;
  type: string | null;
  status: TaskStatus;
  dueAt: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  requiresPhoto: boolean;
  estimateMinutes: number | null;
  spentMinutes: number;
  workId: string | null;
  workTitle: string | null;
  workTotal: string | null; // итого по всей работе
  workPriceSnapshot: string | null; // цена-снимок за единицу
  quantity: string | null; // часть работы, которую берёт задача
  dependencies: { id: string; title: string; status: TaskStatus }[];
  projectId: string;
  projectNumber: string;
  projectTitle: string;
  productId: string | null; // изделие проекта (необязательно)
  productNumber: string | null;
  productTitle: string | null;
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

// Карточка задачи (клик по задаче в проекте, изделии или в разделе «Задачи»).
// Админ/менеджер — просмотр + редактирование; выполненная — только просмотр.
export function TaskDialog({
  task,
  workers,
  canEdit,
  open,
  onOpenChange,
  projectTasks = [],
  works = [],
  products,
}: {
  task: TaskDetails | null;
  workers: { id: string; name: string; hint?: string }[];
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectTasks?: { id: string; title: string; status: TaskStatus }[];
  works?: {
    id: string;
    title: string;
    total: string;
    quantity: string;
    allocated: string;
  }[];
  // Изделия проекта для поля «Изделие»; если не переданы — подгружаются
  // с сервера при входе в редактирование
  products?: { id: string; number: string; title: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [productOptions, setProductOptions] = useState(products ?? []);
  const fileViewer = useFileViewer();
  const [form, setForm] = useState({
    title: "",
    type: "Производство",
    assigneeId: "",
    productId: "",
    workId: "",
    quantity: "",
    dueAt: "",
    estimateMinutes: "",
    dependencyIds: [] as string[],
  });

  if (!task) return null;
  const readOnly = task.status === "DONE" || !canEdit;

  function startEdit() {
    if (!task) return;
    setForm({
      title: task.title,
      type: task.type ?? "Производство",
      assigneeId: task.assigneeId ?? "",
      productId: task.productId ?? "",
      workId: task.workId ?? "",
      quantity: task.quantity ?? "",
      dueAt: task.dueAt ? task.dueAt.slice(0, 10) : "",
      estimateMinutes: task.estimateMinutes?.toString() ?? "",
      dependencyIds: task.dependencies.map((dep) => dep.id),
    });
    setEditing(true);
    // Изделия проекта — если родитель не передал список, подгружаем сами
    if (!products) {
      void fetchProductOptions(task.projectId).then(setProductOptions);
    }
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
            {task.productId && task.productNumber ? (
              <>
                {" · изделие "}
                <Link
                  href={`/products/${task.productId}`}
                  className="underline-offset-2 hover:underline"
                >
                  {task.productNumber}
                  {task.productTitle ? ` · ${task.productTitle}` : ""}
                </Link>
              </>
            ) : null}
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
            <div className="flex flex-col gap-1.5">
              <Label>Изделие</Label>
              <SearchableSelect
                options={productOptions.map((product) => ({
                  value: product.id,
                  label: `${product.number} · ${product.title}`,
                }))}
                value={form.productId}
                onChange={(value) =>
                  setForm((prev) => ({ ...prev, productId: value }))
                }
                placeholder="весь проект"
                searchPlaceholder="Поиск изделия…"
                allowClear
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Работа (оплата)</Label>
                <SearchableSelect
                  options={works.map((work) => {
                    const own =
                      work.id === task.workId && task.quantity
                        ? Number(task.quantity)
                        : 0;
                    const remaining =
                      Number(work.quantity) - Number(work.allocated) + own;
                    return {
                      value: work.id,
                      label: `${work.title} · ${work.total} BYN`,
                      hint:
                        remaining > 0
                          ? `свободно ${remaining} из ${work.quantity}`
                          : "распределена полностью",
                      disabled: remaining <= 0,
                    };
                  })}
                  value={form.workId}
                  onChange={(value) =>
                    setForm((prev) => ({ ...prev, workId: value }))
                  }
                  placeholder="без работы"
                  searchPlaceholder="Поиск работы…"
                  allowClear
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="td-est">Оценка, мин</Label>
                <Input
                  id="td-est"
                  type="number"
                  min="0"
                  value={form.estimateMinutes}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      estimateMinutes: event.target.value,
                    }))
                  }
                  placeholder="—"
                />
              </div>
            </div>
            {form.workId ? (
              <div className="flex flex-col gap-1.5">
                <Label>Количество из работы</Label>
                <QuantityStepper
                  value={form.quantity}
                  onChange={(value) =>
                    setForm((prev) => ({ ...prev, quantity: value }))
                  }
                  remaining={(() => {
                    const work = works.find((item) => item.id === form.workId);
                    if (!work) return 0;
                    const own =
                      work.id === task.workId && task.quantity
                        ? Number(task.quantity)
                        : 0;
                    return (
                      Number(work.quantity) - Number(work.allocated) + own
                    );
                  })()}
                />
              </div>
            ) : null}
            {projectTasks.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <Label>Зависит от (блокируется, пока те не выполнены)</Label>
                <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-lg border p-2">
                  {projectTasks
                    .filter((item) => item.id !== task.id)
                    .map((item) => (
                      <label
                        key={item.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={form.dependencyIds.includes(item.id)}
                          onChange={(event) =>
                            setForm((prev) => ({
                              ...prev,
                              dependencyIds: event.target.checked
                                ? [...prev.dependencyIds, item.id]
                                : prev.dependencyIds.filter((id) => id !== item.id),
                            }))
                          }
                        />
                        <span>{item.title}</span>
                        <span className="text-xs text-muted-foreground">
                          ({taskStatusLabels[item.status]})
                        </span>
                      </label>
                    ))}
                </div>
              </div>
            ) : null}
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
                <div className="text-xs text-muted-foreground">Изделие</div>
                <div>
                  {task.productId && task.productNumber ? (
                    <Link
                      href={`/products/${task.productId}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {task.productNumber}
                      {task.productTitle ? ` · ${task.productTitle}` : ""}
                    </Link>
                  ) : (
                    "весь проект"
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Создана</div>
                <div>{new Date(task.createdAt).toLocaleDateString("ru-RU")}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Время (оценка / факт)</div>
                <div>
                  {task.estimateMinutes ?? "—"} / {task.spentMinutes} мин
                </div>
              </div>
              {task.workTitle ? (
                <div>
                  <div className="text-xs text-muted-foreground">Работа (оплата)</div>
                  <div>
                    {task.workTitle}
                    {task.quantity && task.workPriceSnapshot
                      ? ` · ${task.quantity} ед. × ${task.workPriceSnapshot} = ${(
                          Number(task.quantity) * Number(task.workPriceSnapshot)
                        ).toLocaleString("ru-RU")} BYN`
                      : ""}
                  </div>
                </div>
              ) : null}
            </div>
            {task.dependencies.length > 0 ? (
              <div>
                <div className="mb-1 text-xs text-muted-foreground">
                  Зависит от:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {task.dependencies.map((dep) => (
                    <Badge
                      key={dep.id}
                      variant="outline"
                      className={cn(
                        "border-transparent",
                        dep.status === "DONE"
                          ? taskStatusBadge.DONE
                          : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                      )}
                    >
                      {dep.title}
                      {dep.status !== "DONE" ? " (не выполнена)" : ""}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
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
                Замер: фото обязательны при выполнении
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
                      productId: form.productId || null,
                      workId: form.workId || null,
                      quantity:
                        form.workId && form.quantity.trim() !== ""
                          ? Number(form.quantity)
                          : null,
                      dueAt: form.dueAt,
                      estimateMinutes:
                        form.estimateMinutes.trim() === ""
                          ? null
                          : Number(form.estimateMinutes),
                      dependencyIds: form.dependencyIds,
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
              <div className="flex w-full items-center justify-between">
                <Button
                  variant="destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="size-4" /> Удалить
                </Button>
                <Button variant="outline" onClick={startEdit}>
                  <Pencil className="size-4" /> Редактировать
                </Button>
              </div>
            )
          )}
        </DialogFooter>
      </DialogContent>
      {fileViewer.viewer}
      <ConfirmDeleteDialog
        entityLabel="задачу"
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        warning="Время по ней будет удалено, файлы останутся в проекте."
        onConfirm={async () => {
          const result = await deleteTask(task.id);
          if (result.ok) {
            toast.success("Задача удалена");
            onOpenChange(false);
            router.refresh();
            return true;
          }
          toast.error(result.error ?? "Ошибка");
          return false;
        }}
      />
    </Dialog>
  );
}
