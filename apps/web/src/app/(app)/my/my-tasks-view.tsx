"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  Check,
  LayoutGrid,
  List,
  Play,
  Plus,
  Square,
  Timer,
} from "lucide-react";
import { toast } from "sonner";
import type { Role, TaskStatus } from "@prisma/client";

import { DragHandle } from "@/components/drag-handle";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PhotoUploadButton } from "@/components/photo-upload-button";
import { ActualTimeDialog } from "@/components/actual-time-dialog";
import { taskPaymentLabel } from "@/lib/task-payment-display";
import { requiresManualCompletionTime } from "@/lib/task-completion-prompt";
import { useElapsed } from "@/lib/use-elapsed";
import { cn } from "@/lib/utils";
import { OFFICE_WRITE_ROLES, hasAnyRole } from "@/lib/roles";
import { saveViewPreference } from "@/server/preferences-actions";
import { changeTaskStatus } from "@/server/tasks/actions";
import { addManualTime, startTimer, stopTimer } from "@/server/time/actions";
import type { TaskDetails } from "@/lib/task-details";

// Ручной ввод времени — только если есть офисная роль (комбинированные
// роли, §4): чистый работник/монтажник вводит время только таймером.

const KANBAN_COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: "NEW", label: "Новая" },
  { id: "IN_PROGRESS", label: "В работе" },
  { id: "DONE", label: "Выполнена" },
];

// Разрешённые переходы для перетаскивания (как на сервере)
const DRAG_FLOW: Partial<Record<TaskStatus, TaskStatus[]>> = {
  NEW: ["IN_PROGRESS", "DONE"],
  IN_PROGRESS: ["DONE"],
};

interface ActiveTimer {
  taskId: string;
  taskTitle: string;
  projectNumber: string;
  startedAt: string;
}

function isOverdue(dueAt: string | null): boolean {
  if (!dueAt) return false;
  const due = new Date(dueAt);
  due.setHours(23, 59, 59);
  return due.getTime() < Date.now();
}

// «Мои задачи»: список или канбан (вид сохраняется, §7). Статусы видны всегда.
// Таймер автоматический: «В работу» — старт, «Выполнено» — стоп (§9).
export function MyTasksView({
  active,
  done,
  userName,
  timer,
  role,
  initialView,
}: {
  active: TaskDetails[];
  done: TaskDetails[];
  userName: string;
  timer: ActiveTimer | null;
  role: Role[];
  initialView: "list" | "kanban";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState(initialView);
  const [tasks, setTasks] = useState<TaskDetails[]>([...active, ...done]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [manualFor, setManualFor] = useState<string | null>(null);
  const [manualMinutes, setManualMinutes] = useState("60");
  const [actualFor, setActualFor] = useState<TaskDetails | null>(null);
  const elapsed = useElapsed(timer?.startedAt ?? null);
  // Наследие: проп называется role, внутри — роли пользователя (§4)
  const roles = role;
  const canManualTime = hasAnyRole(roles, OFFICE_WRITE_ROLES);

  // После router.refresh() подтягиваем свежие данные в локальное состояние
  useEffect(() => {
    setTasks([...active, ...done]);
  }, [active, done]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const activeTasks = tasks.filter((task) => task.status !== "DONE");
  const doneTasks = tasks.filter((task) => task.status === "DONE");

  function moveLocal(taskId: string, to: TaskStatus) {
    setTasks((prev) =>
      prev.map((task) => (task.id === taskId ? { ...task, status: to } : task)),
    );
  }

  // «Выполнено»: у работника без записей времени сервер сам откажет с
  // подсказкой; офисным ролям показываем форму фактического времени (§9).
  function completeTask(task: TaskDetails) {
    if (requiresManualCompletionTime(task, canManualTime, timer?.taskId)) {
      setActualFor(task);
      return;
    }
    startTransition(async () => {
      const result = await changeTaskStatus(task.id, "DONE");
      if (result.ok) {
        toast.success("Выполнено!");
        router.refresh();
      } else {
        toast.error(result.error ?? "Ошибка");
      }
    });
  }

  function renderTask(task: TaskDetails, faded = false) {
    const timerHere = timer?.taskId === task.id;
    const timerElsewhere = timer && !timerHere;
    const ownQuantity = task.personalQuantity === undefined
      ? (task.allocationGroupId ? null : task.quantity)
      : task.personalQuantity;
    const ownAmount = taskPaymentLabel(task);
    return (
      <Card className={faded ? "opacity-60" : ""}>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className={cn("min-w-40 flex-1", view === "kanban" && task.status !== "DONE" && "pr-9")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{task.title}</span>
              {task.type ? <Badge variant="outline">{task.type}</Badge> : null}
              {task.status === "IN_PROGRESS" ? (
                <Badge>В работе</Badge>
              ) : task.status === "NEW" ? (
                <Badge variant="outline">Новая</Badge>
              ) : task.status === "DONE" ? (
                <Badge variant="secondary">Выполнена</Badge>
              ) : null}
              {task.status !== "DONE" && isOverdue(task.dueAt) ? (
                <Badge variant="destructive">Просрочена</Badge>
              ) : null}
            </div>
            <div className="text-sm text-muted-foreground">
              {task.projectNumber} · {task.projectTitle}
              {task.productNumber ? ` · изделие ${task.productNumber}` : ""}
              {task.dueAt
                ? ` · до ${new Date(task.dueAt).toLocaleDateString("ru-RU")}`
                : ""}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Время: {task.estimateMinutes ?? "—"} / {task.spentMinutes} мин
              (оценка / факт)
            </div>
            <div className="mt-2 flex flex-col gap-0.5 text-sm">
              {ownQuantity !== null ? <div>Личный объём: {ownQuantity.replace(".", ",")} ед.</div> : null}
              <div>Вознаграждение: {ownAmount}</div>
            </div>
          </div>

          {task.status !== "DONE" ? (
            <div className="flex flex-wrap items-center gap-2">
              {timerHere ? (
                <Button
                  size="lg"
                  variant="destructive"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await stopTimer();
                      if (result.ok) {
                        toast.success(`Записано ${result.minutes} мин`);
                        router.refresh();
                      } else {
                        toast.error(result.error ?? "Ошибка");
                      }
                    })
                  }
                >
                  <Square className="size-4" /> Стоп {elapsed}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={pending || !!timerElsewhere}
                  title={
                    timerElsewhere ? "Сначала остановите другой таймер" : undefined
                  }
                  onClick={() =>
                    startTransition(async () => {
                      const result = await startTimer(task.id);
                      if (result.ok) {
                        toast.success("Таймер запущен");
                        router.refresh();
                      } else {
                        toast.error(result.error ?? "Ошибка");
                      }
                    })
                  }
                >
                  <Timer className="size-4" /> Старт
                </Button>
              )}
              {canManualTime ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  title="Внести время вручную"
                  onClick={() => {
                    setManualFor(task.id);
                    setManualMinutes("60");
                  }}
                >
                  <Plus className="size-4" /> мин
                </Button>
              ) : null}

              {task.status === "NEW" ? (
                <Button
                  variant="outline"
                  disabled={pending}
                  title="Таймер запустится автоматически"
                  onClick={() =>
                    startTransition(async () => {
                      const result = await changeTaskStatus(task.id, "IN_PROGRESS");
                      if (result.ok) {
                        toast.success("В работе — таймер запущен");
                        router.refresh();
                      } else {
                        toast.error(result.error ?? "Ошибка");
                      }
                    })
                  }
                >
                  <Play className="size-4" /> В работу
                </Button>
              ) : null}
              {task.requiresPhoto ? (
                <PhotoUploadButton
                  taskId={task.id}
                  projectId={task.projectId}
                  filesCount={task.files.length}
                  size="default"
                />
              ) : null}
              <Button
                size="lg"
                disabled={pending}
                onClick={() => completeTask(task)}
              >
                <Check className="size-4" /> Выполнено
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  function DraggableTask({ task }: { task: TaskDetails }) {
    const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, isDragging } =
      useDraggable({ id: task.id, disabled: task.status === "DONE" });
    return (
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Translate.toString(transform) }}
        className={cn(
          "relative select-none",
          isDragging && "opacity-40",
          task.status === "DONE" && "cursor-default",
        )}
      >
        {task.status !== "DONE" && <DragHandle ref={setActivatorNodeRef} {...attributes} {...listeners} label={task.title} />}
        {renderTask(task, task.status === "DONE")}
      </div>
    );
  }

  function KanbanColumn({
    column,
    columnTasks,
  }: {
    column: (typeof KANBAN_COLUMNS)[number];
    columnTasks: TaskDetails[];
  }) {
    const { setNodeRef, isOver } = useDroppable({ id: column.id });
    return (
      <div
        ref={setNodeRef}
        data-slot="kanban-column"
        className={cn(
          "flex w-[min(20rem,calc(100vw-2rem))] shrink-0 flex-col gap-2 rounded-xl border p-2 transition-colors",
          isOver && "border-primary/60 bg-accent/40",
        )}
      >
        <div className="flex items-center justify-between px-1 pt-1">
          <span className="text-sm font-medium">{column.label}</span>
          <Badge variant="secondary">{columnTasks.length}</Badge>
        </div>
        <div className="flex min-h-24 flex-col gap-2">
          {columnTasks.map((task) => (
            <DraggableTask key={task.id} task={task} />
          ))}
        </div>
      </div>
    );
  }

  function onDragStart(event: DragStartEvent) {
    setDragId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active: dragActive, over } = event;
    setDragId(null);
    if (!over) return;
    const task = tasks.find((item) => item.id === String(dragActive.id));
    const to = over.id as TaskStatus;
    if (!task || task.status === to || task.status === "DONE") return;
    if (!(DRAG_FLOW[task.status] ?? []).includes(to)) {
      toast.error("Недопустимый переход статуса");
      return;
    }
    const from = task.status;
    moveLocal(task.id, to);
    startTransition(async () => {
      // Форма фактического времени — только офисным ролям
      if (to === "DONE" && requiresManualCompletionTime(task, canManualTime, timer?.taskId)) {
        moveLocal(task.id, from);
        setActualFor(task);
        return;
      }
      const result = await changeTaskStatus(task.id, to as "IN_PROGRESS" | "DONE");
      if (!result.ok) {
        moveLocal(task.id, from); // откат оптимистичного обновления
        toast.error(result.error ?? "Ошибка");
      } else {
        toast.success(to === "IN_PROGRESS" ? "В работе — таймер запущен" : "Выполнено!");
        router.refresh();
      }
    });
  }

  const dragTask = tasks.find((task) => task.id === dragId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Мои задачи</h1>
          <p className="text-sm text-muted-foreground">
            {userName}, у вас активных задач: {activeTasks.length}
          </p>
        </div>
        <ToggleGroup
          value={[view]}
          onValueChange={(value) => {
            const next = value[0] as "list" | "kanban" | undefined;
            if (!next) return;
            setView(next);
            startTransition(async () => {
              await saveViewPreference("my.view", next);
            });
          }}
        >
          <ToggleGroupItem value="list" aria-label="Список">
            <List className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="kanban" aria-label="Канбан">
            <LayoutGrid className="size-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {timer ? (
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <Timer className="size-5 animate-pulse text-primary" />
            <div className="flex-1">
              <div className="text-sm font-medium">
                Идёт таймер: {timer.taskTitle}
              </div>
              <div className="text-xs text-muted-foreground">
                {timer.projectNumber} · {elapsed}
              </div>
            </div>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await stopTimer();
                  if (result.ok) {
                    toast.success(`Записано ${result.minutes} мин`);
                    router.refresh();
                  } else {
                    toast.error(result.error ?? "Ошибка");
                  }
                })
              }
            >
              <Square className="size-4" /> Стоп
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {view === "list" ? (
        <>
          <div className="flex flex-col gap-2">
            {activeTasks.map((task) => (
              <div key={task.id}>{renderTask(task)}</div>
            ))}
            {activeTasks.length === 0 ? (
              <div className="rounded-xl border border-dashed p-12 text-center">
                <div className="text-lg font-medium">Все задачи выполнены 🎉</div>
                <div className="text-sm text-muted-foreground">
                  Новые задачи появятся здесь, когда менеджер их назначит
                </div>
              </div>
            ) : null}
          </div>

          {doneTasks.length > 0 ? (
            <>
              <h2 className="text-sm font-medium text-muted-foreground">
                Недавно выполненные
              </h2>
              <div className="flex flex-col gap-2">
                {doneTasks.map((task) => (
                  <div key={task.id}>{renderTask(task, true)}</div>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragId(null)}
        >
          <div data-slot="kanban-scroll" className="flex min-w-0 gap-3 overflow-x-auto pb-4">
            {KANBAN_COLUMNS.map((column) => (
              <KanbanColumn
                key={column.id}
                column={column}
                columnTasks={tasks.filter((task) => task.status === column.id)}
              />
            ))}
          </div>
          <DragOverlay>
            {dragTask ? (
              <div className="w-80 rotate-2 shadow-lg">
                {renderTask(dragTask, dragTask.status === "DONE")}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Ручной ввод времени (§9) — только офисные роли */}
      {canManualTime ? (
        <Dialog open={!!manualFor} onOpenChange={(open) => !open && setManualFor(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Внести время вручную</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="manual-min">Минуты</Label>
              <Input
                id="manual-min"
                type="number"
                min="1"
                max="1440"
                value={manualMinutes}
                onChange={(event) => setManualMinutes(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Для случаев, когда таймер забыли запустить.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setManualFor(null)}>
                Отмена
              </Button>
              <Button
                disabled={!(Number(manualMinutes) >= 1) || pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await addManualTime({
                      taskId: manualFor!,
                      minutes: Number(manualMinutes),
                    });
                    if (result.ok) {
                      toast.success("Время записано");
                      setManualFor(null);
                      router.refresh();
                    } else {
                      toast.error(result.error ?? "Ошибка");
                    }
                  })
                }
              >
                Записать
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      <ActualTimeDialog
        task={actualFor}
        open={!!actualFor}
        onOpenChange={(open) => !open && setActualFor(null)}
        onDone={() => router.refresh()}
      />
    </div>
  );
}
