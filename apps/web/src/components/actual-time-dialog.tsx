"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

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
import { useTaskStatusCommand } from "@/components/use-task-status-command";
import type { TaskDetails } from "@/components/task-dialog";

// Обязательное фактическое время при «Выполнена» (§9):
// если по задаче нет записей времени — спрашиваем перед закрытием.
// Работник/инженер обычно покрывают таймером; админ/менеджер — этим вводом.
export function ActualTimeDialog({
  task,
  actorUserId = "",
  open,
  onOpenChange,
  onDone,
}: {
  task: TaskDetails | null;
  actorUserId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const changeTaskStatus = useTaskStatusCommand(actorUserId);
  const [minutes, setMinutes] = useState("");
  const [pending, startTransition] = useTransition();

  const displayedMinutes = String(changeTaskStatus.peek(task?.id ?? "")?.actualMinutes ?? minutes);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setMinutes("");
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Фактическое время</DialogTitle>
          <DialogDescription>
            По задаче «{task?.title}» нет записей времени. Укажите, сколько
            минут фактически потрачено — обязательно.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <Label htmlFor="actual-min">Минуты *</Label>
            {task?.estimateMinutes ? (
              <span className="text-xs text-muted-foreground">
                Оценка: {task.estimateMinutes} мин
              </span>
            ) : null}
          </div>
          <Input
            id="actual-min"
            type="number"
            min="1"
            autoFocus
            value={displayedMinutes}
            disabled={Boolean(changeTaskStatus.peek(task?.id ?? ""))}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            disabled={!(Number(displayedMinutes) >= 1) || pending}
            onClick={() =>
              startTransition(async () => {
                const result = await changeTaskStatus(
                  task!.id,
                  "DONE",
                  Number(displayedMinutes),
                );
                if (!result) return;
                if (result.ok && result.replayed) { onOpenChange(false); return; }
                if (result.ok) {
                  toast.success("Выполнено!");
                  onOpenChange(false);
                  onDone();
                } else {
                  toast.error(result.error ?? "Ошибка");
                }
              })
            }
          >
            {pending ? "Закрытие…" : "Выполнено"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
