"use client";

import { useRef, useState, useTransition } from "react";
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
import { formatDate } from "@/lib/format";
import {FileList} from "@/components/file-list";
import type { TaskDetails } from "@/lib/task-details";
import {deleteFile} from "@/server/files/actions";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { QuantityStepper } from "@/components/quantity-stepper";
import { formatDateTime } from "@/lib/format";
import { taskPaymentLabel } from "@/lib/task-payment-display";
import { cn } from "@/lib/utils";

import { isPositiveQuantity, quantityInputError, remainingWorkQuantity } from "@/lib/work-quantity";
import { deleteTask, updateTask } from "@/server/tasks/actions";



export const TASK_TYPES = ["Замер", "Проектирование", "Производство", "Доставка", "Монтаж", "Прочее"];

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
    total: string | null;
    paymentKind?: "LEGACY" | "ENGINEERING" | "INSTALLATION";
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

  const fileDeleteBusy = useRef(false);
  const [filePending, setFilePending] = useState(false);
  const [deletedFiles, setDeletedFiles] = useState<{taskId: string | null; ids: string[]}>({taskId: null, ids: []});
  const [form, setForm] = useState({
    title: "",
    type: "Производство",
    assigneeId: "",
    productId: "",
    workId: "",
    quantity: "",
    dueAt: "",
    dependencyIds: [] as string[],
  });

  if (!task) return null;
  const visibleFiles = task.files.filter(file => deletedFiles.taskId !== task.id || !deletedFiles.ids.includes(file.id));
  const readOnly = task.status === "DONE" || !canEdit;
  const isAllocatedShare = !!task.allocationGroupId;

  const ownQuantity = task.personalQuantity === undefined
    ? (isAllocatedShare ? null : task.quantity)
    : task.personalQuantity;
  const ownAmount = taskPaymentLabel(task);

  function startEdit() {
    if (!task || fileDeleteBusy.current) return;
    setForm({
      title: task.title,
      type: task.type ?? "Производство",
      assigneeId: task.assigneeId ?? "",
      productId: task.productId ?? "",
      workId: task.workId ?? "",
      quantity: task.quantity ?? "",
      dueAt: task.dueAt ? task.dueAt.slice(0, 10) : "",
      dependencyIds: task.dependencies.map((dep) => dep.id),
    });
    setEditing(true);

  }

  const valid = form.title.trim() && form.type && form.dueAt &&
    form.assigneeId && task.productId && task.workId &&
    (isAllocatedShare || (isPositiveQuantity(form.quantity) && !quantityInputError(form.quantity)));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && fileDeleteBusy.current) return;
        if (!next) {
          setEditing(false);
        }
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
                readOnly
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
                  placeholder="Выберите исполнителя"
                  searchPlaceholder="Поиск сотрудника…"

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
                options={task.productId ? [{value: task.productId, label: `${task.productNumber ?? ""} · ${task.productTitle ?? "Изделие работы"}`}] : []}
                value={form.productId}
                disabled
                onChange={(value) =>
                  setForm((prev) => ({ ...prev, productId: value }))
                }
                placeholder="Изделие работы"
                searchPlaceholder="Поиск изделия…"

              />
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Работа (оплата)</Label>
                <SearchableSelect
                  options={task.workId ? [{value: task.workId, label: task.workTitle ?? "Работа изделия"}] : []}
                  value={form.workId}
                  disabled
                  onChange={(value) =>
                    setForm((prev) => ({ ...prev, workId: value }))
                  }
                  placeholder="Работа изделия"
                  searchPlaceholder="Поиск работы…"

                />
              </div>
            </div>
            {isAllocatedShare ? (
              <div className="rounded-lg border p-3 text-sm">
                {ownQuantity !== null ? <div>Личный объём: {ownQuantity.replace(".", ",")} ед.</div> : null}
                <div>Вознаграждение: {ownAmount}</div>
                <p className="mt-1 text-muted-foreground">
                  Изделие и работа закреплены за задачей.
                  Исторический объём сохранён без пересчёта.
                </p>
              </div>
            ) : form.workId ? (
              <div className="flex flex-col gap-1.5">
                <Label>Количество из работы</Label>
                <QuantityStepper
                  value={form.quantity}
                  onChange={(value) =>
                    setForm((prev) => ({ ...prev, quantity: value }))
                  }
                  remaining={(() => {
                    const work = works.find((item) => item.id === form.workId);
                    if (!work) return "0.00";
                    const own =
                      work.id === task.workId && task.quantity
                        ? task.quantity
                        : "0";
                    return remainingWorkQuantity(work.quantity, work.allocated, own);
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
                    ? formatDate(task.dueAt)
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
                <div>{formatDate(task.createdAt)}</div>
              </div>
              {task.workTitle ? (
                <div>
                  <div className="text-xs text-muted-foreground">Работа (оплата)</div>
                  <div>{task.workTitle}</div>
                </div>
              ) : null}
              {ownQuantity !== null ? (
                <div>
                  <div className="text-xs text-muted-foreground">Личный объём</div>
                  <div>{ownQuantity.replace(".", ",")} ед.</div>
                </div>
              ) : null}
              <div>
                <div className="text-xs text-muted-foreground">Вознаграждение</div>
                <div>{ownAmount}</div>
              </div>
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
                  ? formatDateTime(task.doneAt)
                  : ""}
                {task.doneByName ? ` · ${task.doneByName}` : ""}
              </div>
            ) : null}
            {task.requiresPhoto ? (
              <div className="text-muted-foreground">
                Замер: фото обязательны при выполнении
              </div>
            ) : null}
            {visibleFiles.length > 0 ? <FileList files={visibleFiles}
              onDelete={(file, clientMutationId) => deleteFile(file.id, clientMutationId)}
              onBusyChange={busy => {fileDeleteBusy.current = busy;setFilePending(busy);}}
              onDeleted={file => {
                setDeletedFiles(previous => ({taskId: task.id, ids: previous.taskId === task.id ? [...previous.ids, file.id] : [file.id]}));
                router.refresh();
              }} /> : null}
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
                      assigneeId: form.assigneeId,
                      ...(!isAllocatedShare ? {
                        productId: task.productId,
                        workId: task.workId,
                        quantity:
                          form.workId && form.quantity.trim() !== ""
                            ? Number(form.quantity)
                            : null,
                      } : {}),
                      dueAt: form.dueAt,
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
              <div className="flex w-full flex-wrap items-center justify-end gap-2">
                {!readOnly && !isAllocatedShare ? (
                  <Button
                    variant="destructive"
                    className="sm:mr-auto"
                    disabled={filePending}
                    onClick={() => {if (!fileDeleteBusy.current) setDeleteOpen(true);}}
                  >
                    <Trash2 className="size-4" /> Удалить
                  </Button>
                ) : null}
                {!readOnly ? (
                  <Button variant="outline" disabled={filePending} onClick={startEdit}>
                    <Pencil className="size-4" /> Редактировать
                  </Button>
                ) : null}
              </div>
            )
          )}
        </DialogFooter>
      </DialogContent>
      <ConfirmDeleteDialog
        entityLabel="задачу"
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        warning="Время по ней будет удалено, файлы останутся в проекте."
        onConfirm={async () => {
          if (fileDeleteBusy.current) return false;
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
