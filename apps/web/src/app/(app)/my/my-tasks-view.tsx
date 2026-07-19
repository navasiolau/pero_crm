"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Play, Plus, Square, Timer } from "lucide-react";
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
import { PhotoUploadButton } from "@/components/photo-upload-button";
import { ActualTimeDialog } from "@/components/actual-time-dialog";
import { changeTaskStatus } from "@/server/tasks/actions";
import { addManualTime, startTimer, stopTimer } from "@/server/time/actions";
import type { TaskDetails } from "@/components/task-dialog";

interface ActiveTimer {
  taskId: string;
  taskTitle: string;
  projectNumber: string;
  startedAt: string;
}

function useElapsed(startedAt: string | null): string {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const interval = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);
  if (!startedAt) return "";
  const total = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function isOverdue(dueAt: string | null): boolean {
  if (!dueAt) return false;
  const due = new Date(dueAt);
  due.setHours(23, 59, 59);
  return due.getTime() < Date.now();
}

// «Мои задачи»: увидел → таймер (серверный, §9) → стоп → выполнил → фото (§6.2).
export function MyTasksView({
  active,
  done,
  userName,
  timer,
}: {
  active: TaskDetails[];
  done: TaskDetails[];
  userName: string;
  timer: ActiveTimer | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [manualFor, setManualFor] = useState<string | null>(null);
  const [manualMinutes, setManualMinutes] = useState("60");
  const [actualFor, setActualFor] = useState<TaskDetails | null>(null);
  const elapsed = useElapsed(timer?.startedAt ?? null);

  // «Выполнено»: если фактического времени нет — спросим обязательно (§9)
  function completeTask(task: TaskDetails) {
    if (task.spentMinutes === 0) {
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
    return (
      <Card key={task.id} className={faded ? "opacity-60" : ""}>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-40 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{task.title}</span>
              {task.type ? <Badge variant="outline">{task.type}</Badge> : null}
              {task.status === "DONE" ? (
                <Badge variant="secondary">Выполнена</Badge>
              ) : isOverdue(task.dueAt) ? (
                <Badge variant="destructive">Просрочена</Badge>
              ) : null}
            </div>
            <div className="text-sm text-muted-foreground">
              {task.projectNumber} · {task.projectTitle}
              {task.dueAt
                ? ` · до ${new Date(task.dueAt).toLocaleDateString("ru-RU")}`
                : ""}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Время: {task.estimateMinutes ?? "—"} / {task.spentMinutes} мин
              (оценка / факт)
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

              {task.status === "NEW" ? (
                <Button
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

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Мои задачи</h1>
        <p className="text-sm text-muted-foreground">
          {userName}, у вас активных задач: {active.length}
        </p>
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

      <div className="flex flex-col gap-2">
        {active.map((task) => renderTask(task))}
        {active.length === 0 ? (
          <div className="rounded-xl border border-dashed p-12 text-center">
            <div className="text-lg font-medium">Все задачи выполнены 🎉</div>
            <div className="text-sm text-muted-foreground">
              Новые задачи появятся здесь, когда менеджер их назначит
            </div>
          </div>
        ) : null}
      </div>

      {done.length > 0 ? (
        <>
          <h2 className="text-sm font-medium text-muted-foreground">
            Недавно выполненные
          </h2>
          <div className="flex flex-col gap-2">
            {done.map((task) => renderTask(task, true))}
          </div>
        </>
      ) : null}

      {/* Ручной ввод времени (§9) */}
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

      <ActualTimeDialog
        task={actualFor}
        open={!!actualFor}
        onOpenChange={(open) => !open && setActualFor(null)}
        onDone={() => router.refresh()}
      />
    </div>
  );
}
