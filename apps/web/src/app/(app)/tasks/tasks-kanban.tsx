"use client";

import { useState } from "react";
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
import { toast } from "sonner";
import type { TaskStatus } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ActualTimeDialog } from "@/components/actual-time-dialog";
import {
  taskStatusBadge,
  taskStatusLabels,
  type TaskDetails,
} from "@/components/task-dialog";
import { cn } from "@/lib/utils";
import { changeTaskStatus } from "@/server/tasks/actions";

const COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: "DRAFT", label: "Черновики" },
  { id: "NEW", label: "Новые" },
  { id: "IN_PROGRESS", label: "В работе" },
  { id: "DONE", label: "Выполнена" },
];

// Разрешённые переходы для drag-n-drop (полный поток — §9)
const DRAG_FLOW: Record<TaskStatus, TaskStatus[]> = {
  DRAFT: [], // черновик нельзя двигать — сначала назначить исполнителя
  NEW: ["IN_PROGRESS", "DONE"],
  IN_PROGRESS: ["DONE"],
  DONE: [],
};

function TaskCardView({ task, dragging }: { task: TaskDetails; dragging?: boolean }) {
  return (
    <Card className={cn("cursor-grab touch-none select-none", dragging && "rotate-2 shadow-lg")}>
      <CardContent className="flex flex-col gap-1.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{task.title}</span>
          {task.type ? (
            <Badge variant="outline" className="text-xs">
              {task.type}
            </Badge>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">
          {task.projectNumber} · {task.projectTitle}
          {task.productNumber ? ` · ${task.productNumber}` : ""}
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{task.assigneeName ?? "без исполнителя"}</span>
          {task.dueAt ? (
            <span>до {new Date(task.dueAt).toLocaleDateString("ru-RU")}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function DraggableTask({
  task,
  canDrag,
  onOpen,
}: {
  task: TaskDetails;
  canDrag: boolean;
  onOpen: (task: TaskDetails) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id, disabled: !canDrag });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(isDragging && "opacity-40")}
      {...(canDrag ? { ...listeners, ...attributes } : {})}
      onClick={() => onOpen(task)}
    >
      <TaskCardView task={task} />
    </div>
  );
}

// Канбан задач (§7): колонки = статусы, перетаскивание меняет статус
// с теми же правилами, что и кнопки (поток, замер с фото — §6.2).
export function TasksKanban({
  initialTasks,
  canManage,
  onOpen,
}: {
  initialTasks: TaskDetails[];
  canManage: boolean;
  onOpen: (task: TaskDetails) => void;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [actualFor, setActualFor] = useState<TaskDetails | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  function applyStatus(taskId: string, status: TaskStatus) {
    setTasks((prev) =>
      prev.map((task) => (task.id === taskId ? { ...task, status } : task)),
    );
  }

  async function moveTo(task: TaskDetails, toStatus: TaskStatus) {
    if (toStatus === "DONE" && task.requiresPhoto && task.files.length === 0) {
      toast.error("Приложите файлы (фото/замерный лист) перед выполнением");
      return;
    }
    // Обязательное фактическое время при «Выполнена» (§9)
    if (toStatus === "DONE" && task.spentMinutes === 0) {
      setActualFor(task);
      return;
    }
    const fromStatus = task.status;
    applyStatus(task.id, toStatus);
    const result = await changeTaskStatus(task.id, toStatus as "IN_PROGRESS" | "DONE");
    if (!result.ok) {
      applyStatus(task.id, fromStatus); // откат
      toast.error(result.error ?? "Не удалось сменить статус");
      return;
    }
    toast.success(`Статус: ${taskStatusLabels[toStatus]}`);
    router.refresh();
  }

  function onDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    const task = tasks.find((item) => item.id === String(active.id));
    const toStatus = over.id as TaskStatus;
    if (!task || task.status === toStatus) return;
    if (!DRAG_FLOW[task.status].includes(toStatus)) {
      toast.error(
        task.status === "DRAFT"
          ? "Черновик двигается через назначение исполнителя — откройте задачу"
          : "Недопустимый переход статуса",
      );
      return;
    }
    void moveTo(task, toStatus);
  }

  const activeTask = tasks.find((task) => task.id === activeId);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map((column) => (
          <TasksColumn
            key={column.id}
            column={column}
            tasks={tasks.filter((task) => task.status === column.id)}
            canManage={canManage}
            onOpen={onOpen}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? <TaskCardView task={activeTask} dragging /> : null}
      </DragOverlay>
      <ActualTimeDialog
        task={actualFor}
        open={!!actualFor}
        onOpenChange={(open) => !open && setActualFor(null)}
        onDone={() => router.refresh()}
      />
    </DndContext>
  );
}

function TasksColumn({
  column,
  tasks,
  canManage,
  onOpen,
}: {
  column: { id: TaskStatus; label: string };
  tasks: TaskDetails[];
  canManage: boolean;
  onOpen: (task: TaskDetails) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-64 shrink-0 flex-col gap-2 rounded-xl border bg-muted/40 p-2 transition-colors",
        isOver && "border-primary/60 bg-accent/40",
      )}
    >
      <div className="flex items-center justify-between px-1 pt-1">
        <span className="text-sm font-medium">{column.label}</span>
        <Badge
          variant="outline"
          className={cn("border-transparent", taskStatusBadge[column.id])}
        >
          {tasks.length}
        </Badge>
      </div>
      <div className="flex min-h-24 flex-col gap-2">
        {tasks.map((task) => (
          <DraggableTask
            key={task.id}
            task={task}
            canDrag={canManage && DRAG_FLOW[task.status].length > 0}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}
