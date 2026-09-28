"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Play, Plus, Trash2 } from "lucide-react";
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
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { ActualTimeDialog } from "@/components/actual-time-dialog";
import { PhotoUploadButton } from "@/components/photo-upload-button";
import { QuantityStepper } from "@/components/quantity-stepper";
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
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isPositiveQuantity, quantityInputError, remainingWorkQuantity } from "@/lib/work-quantity";
import { changeTaskStatus, createTask } from "@/server/tasks/actions";
import { addWork, removeWork } from "@/server/works/actions";

import type { SelectOption } from "../projects-view";

export interface WorkRow {
  id: string;
  title: string;
  quantity: string;
  allocated: string;
  priceSnapshot: string | null;
  total: string | null;
  paymentKind?: "LEGACY" | "ENGINEERING";
  linkedTask: { id: string; title: string; status: string } | null;
}

export interface PriceOption {
  id: string;
  name: string;
  unit: string;
  price: string;
}

export interface ProductOption {
  id: string;
  number: string;
  title: string;
}

function tomorrow(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Вкладка «Работы и задачи». Работы — расценка × количество со снимком цены (§9).
// Клик по задаче — карточка (просмотр/правка). Замер — с фото (§6.2).
// Используется и в карточке проекта (все задачи, изделие — выбор),
// и в карточке изделия (productId зафиксирован).
export function TasksTab({
  projectId,
  productId,
  products = [],
  tasks,
  works,
  priceItems,
  canManage,
  workers,
}: {
  projectId: string;
  productId?: string; // зафиксированное изделие (карточка изделия)
  products?: ProductOption[]; // изделия проекта — выбор в диалоге задачи
  tasks: TaskDetails[];
  works: WorkRow[];
  priceItems: PriceOption[];
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
  const [taskProductId, setTaskProductId] = useState(productId ?? "");
  const [workId, setWorkId] = useState("");
  const [estimate, setEstimate] = useState("");
  const [dueAt, setDueAt] = useState(tomorrow);
  const [workOpen, setWorkOpen] = useState(false);
  const [deleteWorkFor, setDeleteWorkFor] = useState<WorkRow | null>(null);
  const [actualFor, setActualFor] = useState<TaskDetails | null>(null);
  const [priceItemId, setPriceItemId] = useState("");
  const [quantity, setQuantity] = useState("1");

  const worksTotal = works.filter((work) => work.paymentKind !== "ENGINEERING").reduce((sum, work) => sum + Number(work.total ?? 0), 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Работы (§9): расценка × количество, цена — снимок на момент назначения */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">
            {works.some((work) => work.paymentKind === "ENGINEERING") ? "Сдельные работы" : "Работы"} · итого {formatAmount(worksTotal, "BYN")}
          </h3>
          {canManage ? (
            <Button size="sm" variant="outline" onClick={() => setWorkOpen(true)}>
              <Plus className="size-4" /> Работа
            </Button>
          ) : null}
        </div>
        {works.map((work) => {
          const remaining = remainingWorkQuantity(work.quantity, work.allocated);
          return (
            <div
              key={work.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-sm"
            >
              <span className="flex-1">
                {work.title}
                {isPositiveQuantity(remaining) ? (
                  <Badge variant="secondary" className="ml-2">
                    свободно {remaining} из {work.quantity}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="ml-2">
                    распределена полностью
                  </Badge>
                )}
              </span>
              <span className="text-muted-foreground">
                {work.paymentKind === "ENGINEERING" ? "Инженерный фонд" : `${formatAmount(work.priceSnapshot, "BYN")} × ${work.quantity}`}
              </span>
              <span className="font-medium">
                {work.paymentKind === "ENGINEERING" ? "Оплата по долям фонда" : formatAmount(work.total, "BYN")}
              </span>
            {canManage && work.paymentKind !== "ENGINEERING" ? (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Удалить работу"
                disabled={pending}
                onClick={() => setDeleteWorkFor(work)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            ) : null}
            </div>
          );
        })}
        {works.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Работ не назначено — добавляются из прайса со снимком цены.
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex justify-between">
          <p className="text-sm text-muted-foreground">
            Клик по задаче — просмотр{canManage ? " и редактирование" : ""}.
            Замер требует фото при выполнении.
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
                {!productId && task.productNumber ? (
                  <Badge variant="secondary" className="text-xs">
                    {task.productNumber}
                  </Badge>
                ) : null}
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
                    <PhotoUploadButton
                      taskId={task.id}
                      projectId={projectId}
                      filesCount={task.files.length}
                      size="sm"
                    />
                  ) : null}
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (task.spentMinutes === 0) {
                        setActualFor(task);
                        return;
                      }
                      startTransition(async () => {
                        const result = await changeTaskStatus(task.id, "DONE");
                        if (result.ok) {
                          toast.success("Задача выполнена");
                        } else {
                          toast.error(result.error ?? "Ошибка");
                        }
                      });
                    }}
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
      </div>

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
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="est">Оценка времени, мин</Label>
              <Input
                id="est"
                type="number"
                min="0"
                value={estimate}
                onChange={(event) => setEstimate(event.target.value)}
                placeholder="пусто — среднее из истории"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Изделие</Label>
              <SearchableSelect
                options={products.map((product) => ({
                  value: product.id,
                  label: `${product.number} · ${product.title}`,
                }))}
                value={taskProductId}
                onChange={setTaskProductId}
                placeholder="весь проект"
                searchPlaceholder="Поиск изделия…"
                allowClear
                disabled={!!productId}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Работа (оплата)</Label>
              <SearchableSelect
                options={works.map((work) => {
                  const remaining = remainingWorkQuantity(work.quantity, work.allocated);
                  return {
                    value: work.id,
                    label: `${work.title} · ${work.paymentKind === "ENGINEERING" ? "Инженерный фонд" : `${formatAmount(work.priceSnapshot, "BYN")}/ед.`}`,
                    hint:
                      isPositiveQuantity(remaining)
                        ? `свободно ${remaining} из ${work.quantity}`
                        : "распределена полностью",
                    disabled: work.paymentKind === "ENGINEERING" || !isPositiveQuantity(remaining),
                  };
                })}
                value={workId}
                onChange={(value) => {
                  setWorkId(value);
                  const work = works.find((item) => item.id === value);
                  const remaining = work
                    ? remainingWorkQuantity(work.quantity, work.allocated)
                    : "0.00";
                  setQuantity(isPositiveQuantity(remaining) ? remaining : "");
                }}
                placeholder="без работы"
                searchPlaceholder="Поиск работы…"
                allowClear
              />
            </div>
            {workId ? (
              <div className="flex flex-col gap-1.5">
                <Label>Количество из работы</Label>
                <QuantityStepper
                  value={quantity}
                  onChange={setQuantity}
                  remaining={(() => {
                    const work = works.find((item) => item.id === workId);
                    return work
                      ? remainingWorkQuantity(work.quantity, work.allocated)
                      : "0.00";
                  })()}
                />
                <p className="text-xs text-muted-foreground">
                  Сдельная оплата = цена-снимок × количество.
                </p>
              </div>
            ) : null}
            {!assigneeId ? (
              <p className="text-xs text-muted-foreground">
                Без исполнителя задача создаётся черновиком — будет подписана
                значком «Черновик», пока исполнителя не выберут.
              </p>
            ) : null}
            {type === "Замер" ? (
              <p className="text-xs text-muted-foreground">
                Замер: при выполнении система потребует приложить
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
              disabled={!title.trim() || !type || !dueAt || (!!workId && !!quantityInputError(quantity)) || pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await createTask({
                    projectId,
                    productId: taskProductId || undefined,
                    title: title.trim(),
                    type,
                    assigneeId: assigneeId || undefined,
                    workId: workId || undefined,
                    quantity:
                      workId && quantity.trim() !== ""
                        ? Number(quantity)
                        : undefined,
                    dueAt,
                    estimateMinutes:
                      estimate.trim() === "" ? undefined : Number(estimate),
                    requiresPhoto: type === "Замер",
                  });
                  if (result.ok) {
                    toast.success("Задача создана");
                    setOpen(false);
                    setTitle("");
                    setType("Производство");
                    setAssigneeId("");
                    setTaskProductId(productId ?? "");
                    setWorkId("");
                    setEstimate("");
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
        products={products}
        projectTasks={tasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
        }))}
        works={works.map((work) => ({
          id: work.id,
          title: work.title,
          total: work.total,
          paymentKind: work.paymentKind,
          quantity: work.quantity,
          allocated: work.allocated,
        }))}
        open={!!selected}
        onOpenChange={(next) => !next && setSelected(null)}
      />

      {/* Добавление работы из прайса (§9) */}
      <Dialog open={workOpen} onOpenChange={setWorkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая работа</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Расценка из прайса *</Label>
              <SearchableSelect
                options={priceItems.map((item) => ({
                  value: item.id,
                  label: item.name,
                  hint: `${formatAmount(item.price, "BYN")} / ${item.unit}`,
                }))}
                value={priceItemId}
                onChange={setPriceItemId}
                placeholder="Выберите расценку…"
                searchPlaceholder="Поиск расценки…"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="work-qty">Количество *</Label>
              <Input
                id="work-qty"
                type="number"
                min="0.01"
                step="0.01"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>
            {priceItemId && Number(quantity) > 0 ? (
              <p className="text-sm text-muted-foreground">
                Итого:{" "}
                {formatAmount(
                  Number(
                    priceItems.find((item) => item.id === priceItemId)?.price,
                  ) * Number(quantity),
                  "BYN",
                )}{" "}
                — цена зафиксируется снимком (смена прайса её не изменит).
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWorkOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={!priceItemId || !(Number(quantity) > 0) || pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await addWork({
                    projectId,
                    productId: productId || undefined,
                    priceItemId,
                    quantity: Number(quantity),
                  });
                  if (result.ok) {
                    toast.success("Работа добавлена");
                    setWorkOpen(false);
                    setPriceItemId("");
                    setQuantity("1");
                    router.refresh();
                  } else {
                    toast.error(result.error ?? "Ошибка");
                  }
                })
              }
            >
              Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDeleteDialog
        entityLabel={`работу «${deleteWorkFor?.title ?? ""}»`}
        open={!!deleteWorkFor}
        onOpenChange={(open) => !open && setDeleteWorkFor(null)}
        onConfirm={async () => {
          const result = await removeWork(deleteWorkFor!.id);
          if (result.ok) {
            toast.success("Работа удалена");
            return true;
          }
          toast.error(result.error ?? "Ошибка");
          return false;
        }}
      />

      <ActualTimeDialog
        task={actualFor}
        open={!!actualFor}
        onOpenChange={(open) => !open && setActualFor(null)}
        onDone={() => router.refresh()}
      />
    </div>
  );
}
