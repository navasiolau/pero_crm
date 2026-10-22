"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Play, Plus, Trash2, Pencil } from "lucide-react";
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
} from "@/components/task-dialog";
import type { TaskDetails } from "@/lib/task-details";
import {WorkerTaskAllocationDialog,type WorkerAllocationData} from "@/components/worker-task-allocation-dialog";
import {WorkDialog} from "@/components/work-dialog";
import type {WorkOperation} from "@/server/works/queries";
import { formatDate,formatAmount } from "@/lib/format";
import { workPaymentAmountLabel, workPaymentSourceLabel, taskPaymentLabel } from "@/lib/task-payment-display";
import { cn } from "@/lib/utils";
import { isPositiveQuantity, quantityInputError, remainingWorkQuantity } from "@/lib/work-quantity";
import { useTaskCreateCommand } from "@/components/use-task-create-command";
import { useTaskStatusCommand } from "@/components/use-task-status-command";
import { removeWork } from "@/server/works/actions";
import { PieceworkButton } from "@/components/piecework-allocation-dialog";

import type { SelectOption } from "../projects-view";

export interface WorkRow {
  id: string;
  title: string;
  quantity: string;
  quantityPerUnit?: string | null;
  unitSnapshot?: string|null;
  allocated: string;
  stagePayPoolId?:string|null;
  canAllocateWorker?:boolean;
  productId?: string | null;
  canDistributePiecework?: boolean;
  operation?:WorkOperation;
  priceSnapshot: string | null;
  total: string | null;
  paymentKind?: "LEGACY" | "ENGINEERING" | "INSTALLATION";
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
  productQuantity = 1,
  productStatus,
  products = [],
  tasks,
  works,
  priceItems,
  canManage,
  canAddWork=canManage,
  canAllocateWork=false,
  actorUserId="",
  allocationData,
  workers,
}: {
  projectId: string;
  productQuantity?: number;
  productStatus?:string;
  productId?: string; // зафиксированное изделие (карточка изделия)
  products?: ProductOption[]; // изделия проекта — выбор в диалоге задачи
  tasks: TaskDetails[];
  works: WorkRow[];
  priceItems: PriceOption[];
  canManage: boolean;
  canAddWork?:boolean;
  canAllocateWork?:boolean;
  actorUserId?:string;
  allocationData?:WorkerAllocationData;
  workers: SelectOption[];
}) {
  const router = useRouter();
  const changeTaskStatus = useTaskStatusCommand(actorUserId);
  const createCommand = useTaskCreateCommand(actorUserId);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<TaskDetails | null>(null);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("Производство");
  const [assigneeId, setAssigneeId] = useState("");
  const [taskProductId, setTaskProductId] = useState(productId ?? "");
  const [workId, setWorkId] = useState("");
  const [dueAt, setDueAt] = useState(tomorrow);
  const [workOpen, setWorkOpen] = useState(false);
  const [editWork,setEditWork]=useState<WorkRow|null>(null);
  const [workDialogRevision,setWorkDialogRevision]=useState(0);
  const [ownAllocation,setOwnAllocation]=useState(false);
  const [allocationWork,setAllocationWork]=useState<WorkRow|null>(null);
  const [deleteWorkFor, setDeleteWorkFor] = useState<WorkRow | null>(null);
  const [quantity, setQuantity] = useState("1");
  const pinnedCreate = createCommand.peek({ projectId, productId, workId });
  function openTaskCreation(work: WorkRow, remaining: string) {
    const saved = createCommand.peek({ projectId, productId, workId: work.id })?.request;
    setWorkId(work.id); setTaskProductId(saved?.productId ?? productId ?? "");
    setTitle(saved?.title ?? work.title); setQuantity(saved?.quantity === undefined ? remaining : String(saved.quantity));
    setAssigneeId(saved?.assigneeId ?? "");
    if (saved) {
      setType(saved.type);
      setDueAt(saved.dueAt);
    }
    setOpen(true);
  }

  const pieceWorks = works.filter((work) => work.paymentKind !== "ENGINEERING" && work.paymentKind !== "INSTALLATION");
  const worksTotal = pieceWorks.reduce((sum, work) => sum + Number(work.total ?? 0), 0);
  const hasPercentageSource = works.some((work) => work.paymentKind === "ENGINEERING" || work.paymentKind === "INSTALLATION");
  function closeWorkDialog(){setWorkOpen(false);setEditWork(null);setWorkDialogRevision(value=>value+1);}

  return (
    <div className="flex flex-col gap-5">
      {/* Работы (§9): расценка × количество, цена — снимок на момент назначения */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">
            {hasPercentageSource ? "Сдельные работы" : "Работы"}{pieceWorks.length && pieceWorks.every(work=>work.total!==null) ? ` · итого ${formatAmount(worksTotal, "BYN")}` : ""}
          </h3>
          {canAddWork ? (
            <Button size="sm" variant="outline" onClick={() => setWorkOpen(true)}>
              <Plus className="size-4" /> Работа
            </Button>
          ) : null}
        </div>
        {works.map((work) => {
          const remaining = work.operation?.remaining ?? remainingWorkQuantity(work.quantity, work.allocated);
          return (
            <div
              key={work.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-sm"
            >
              <span className="flex-1">
                {work.title}{work.unitSnapshot ? ` · ${work.unitSnapshot}` : ""}
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
                {workPaymentSourceLabel(work)}
              </span>
              {work.quantityPerUnit != null && <span className="text-muted-foreground">На 1 изделие: {work.quantityPerUnit}; всего: {work.quantity}</span>}
              <span className="font-medium">
                {workPaymentAmountLabel(work)}
              </span>
            {work.operation?.canEdit&&productId?<Button size="icon-xs" variant="ghost" aria-label="Редактировать работу" onClick={()=>setEditWork(work)}><Pencil className="size-3.5"/></Button>:null}
            {canAllocateWork&&!canManage&&productId&&allocationData&&work.canAllocateWorker&&isPositiveQuantity(remaining)?<><Button size="sm" variant="outline" onClick={()=>{setOwnAllocation(true);setAllocationWork(work);}}>Взять себе</Button><Button size="sm" variant="outline" onClick={()=>{setOwnAllocation(false);setAllocationWork(work);}}>Назначить задачу</Button></>:null}
            {canManage && productId && work.paymentKind !== "ENGINEERING" && work.paymentKind !== "INSTALLATION" && work.priceSnapshot !== null && (isPositiveQuantity(remaining) || createCommand.peek({projectId,productId,workId:work.id})) ? <Button size="sm" variant="outline" onClick={() => openTaskCreation(work, remaining)}>Назначить задачу</Button> : null}
            {work.canDistributePiecework && (work.productId || productId) && isPositiveQuantity(remaining) ? <PieceworkButton label="Распределить в процентах"
              context={{ mode: "create", projectId, productId: (work.productId || productId)!, work: { id: work.id, title: work.title, unit: work.unitSnapshot ?? "ед." } }}/> : null}
            {canManage && work.paymentKind !== "ENGINEERING" && work.paymentKind !== "INSTALLATION" ? (
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

      </div>

      {canAllocateWork&&!canManage&&allocationData?.createdAssignments.length?<section className="flex flex-col gap-2" aria-label="Созданные назначения"><h3 className="text-sm font-medium">Мои назначения работникам</h3>{allocationData.createdAssignments.map(task=><div key={task.id} className="rounded-xl border p-3 text-sm"><span>{task.title} · {task.assigneeName} · количество {task.quantity} · Вознаграждение: {taskPaymentLabel(task)}</span><Badge variant="outline" className="ml-2">{taskStatusLabels[task.status as keyof typeof taskStatusLabels]??task.status}</Badge>{task.dueAt?<p className="text-xs text-muted-foreground">Срок: {formatDate(task.dueAt)}</p>:null}</div>)}</section>:null}
      {allocationWork&&productId&&allocationData?<WorkerTaskAllocationDialog key={`${allocationWork.id}:${ownAllocation}`} own={ownAllocation} defaultType={productStatus==='INSTALLATION'?'Монтаж':'Производство'} projectId={projectId} productId={productId} actorUserId={actorUserId} work={{id:allocationWork.id,title:allocationWork.title,unit:allocationWork.unitSnapshot,remaining:allocationWork.operation?.remaining??remainingWorkQuantity(allocationWork.quantity,allocationWork.allocated)}} data={allocationData} onClose={()=>setAllocationWork(null)}/>:null}
      <div className="flex flex-col gap-3">

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
                {task.assigneeName ?? "—"}
                {` · Вознаграждение: ${taskPaymentLabel(task)}`}
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
                      if (!result || result.ok && result.replayed) return;
                      if (!result.ok) toast.error(result.error ?? "Ошибка");
                    })
                  }
                >
                  <Play className="size-4" /> Взять в работу
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
                      startTransition(async () => {
                        const result = await changeTaskStatus(task.id, "DONE");
                        if (!result || result.ok && result.replayed) return;
                        if (result.ok) {
                          toast.success("Задача выполнена");
                        } else {
                          toast.error(result.error ?? "Ошибка");
                        }
                      });
                    }}
                  >
                    <Check className="size-4" /> Завершить
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
          <fieldset disabled={!!pinnedCreate || pending} className="flex min-w-0 flex-col gap-3 border-0 p-0">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-title">Название *</Label>
              <Input
                id="task-title"
                value={title}
                readOnly
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
                  placeholder="Выберите исполнителя"
                  searchPlaceholder="Поиск сотрудника…"

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
              <Label>Изделие</Label>
              <SearchableSelect
                options={products.map((product) => ({
                  value: product.id,
                  label: `${product.number} · ${product.title}`,
                }))}
                value={taskProductId}
                onChange={setTaskProductId}
                placeholder="Изделие работы"
                searchPlaceholder="Поиск изделия…"

                disabled
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Работа (оплата)</Label>
              <SearchableSelect
                options={works.filter(work => work.id === workId).map(work => ({value: work.id, label: work.title}))}
                value={workId}
                disabled
                onChange={(value) => {
                  setWorkId(value);
                  const work = works.find((item) => item.id === value);
                  const remaining = work
                    ? remainingWorkQuantity(work.quantity, work.allocated)
                    : "0.00";
                  setQuantity(isPositiveQuantity(remaining) ? remaining : "");
                }}
                placeholder="Работа изделия"
                searchPlaceholder="Поиск работы…"

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
            {type === "Замер" ? (
              <p className="text-xs text-muted-foreground">
                Замер: при выполнении система потребует приложить
                фото/замерный лист — файлы попадут в проект с категорией
                «Замер».
              </p>
            ) : null}
          </fieldset>
          {pinnedCreate?.uncertain ? <p role="status" className="text-sm text-destructive">Результат назначения неизвестен. Проверьте прежний запрос, прежде чем создавать новую задачу.</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={pending || !pinnedCreate && (!title.trim() || !type || !dueAt || !productId || taskProductId !== productId || !workId || !assigneeId || !isPositiveQuantity(quantity) || !!quantityInputError(quantity))}
              onClick={() =>
                startTransition(async () => {
                  const result = await createCommand.run(pinnedCreate?.request ?? {
                    projectId,
                    productId,
                    title: title.trim(),
                    type,
                    assigneeId,
                    workId,
                    quantity:
                      workId && quantity.trim() !== ""
                        ? Number(quantity)
                        : undefined,
                    dueAt,
                    requiresPhoto: type === "Замер",
                  });
                  if (!result) return;
                  if (result.ok) {
                    toast.success(result.replayed ? "Результат назначения подтверждён" : "Задача создана");
                    setOpen(false);
                    setTitle("");
                    setType("Производство");
                    setAssigneeId("");
                    setTaskProductId(productId ?? "");
                    setWorkId("");
                    setDueAt(tomorrow());
                    router.refresh();
                  } else {
                    toast.error(result.error ?? "Ошибка");
                  }
                })
              }
            >
              {pinnedCreate?.uncertain ? "Проверить" : "Создать"}
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

      <WorkDialog key={`${editWork?.id??'create'}:${workDialogRevision}`} open={workOpen||editWork!==null} onClose={closeWorkDialog}
        projectId={projectId} productId={productId} productQuantity={productQuantity} priceItems={priceItems}
        work={editWork?(works.find(work=>work.id===editWork.id)??editWork):undefined}/>
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

    </div>
  );
}
