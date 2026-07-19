"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Play } from "lucide-react";
import { toast } from "sonner";
import type { TaskStatus } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { changeTaskStatus } from "@/server/tasks/actions";

interface MyTask {
  id: string;
  title: string;
  type: string | null;
  status: TaskStatus;
  dueAt: string | null;
  requiresPhoto: boolean;
  filesCount: number;
  projectId: string;
  projectNumber: string;
  projectTitle: string;
  clientName: string;
}

function isOverdue(dueAt: string | null): boolean {
  if (!dueAt) return false;
  const due = new Date(dueAt);
  due.setHours(23, 59, 59);
  return due.getTime() < Date.now();
}

// «Мои задачи»: увидел → выполнил (одна кнопка). Замер — с фото (§6.2).
export function MyTasksView({
  active,
  done,
  userName,
}: {
  active: MyTask[];
  done: MyTask[];
  userName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  function uploadPhoto(task: MyTask, file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("projectId", task.projectId);
    form.append("taskId", task.id);
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

  function renderTask(task: MyTask, faded = false) {
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
              {task.projectNumber} · {task.projectTitle} · {task.clientName}
              {task.dueAt
                ? ` · до ${new Date(task.dueAt).toLocaleDateString("ru-RU")}`
                : ""}
            </div>
          </div>
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
                      if (file) uploadPhoto(task, file);
                      event.target.value = "";
                    }}
                  />
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => fileInputs.current[task.id]?.click()}
                  >
                    <Camera className="size-4" />
                    {task.filesCount > 0 ? `Фото (${task.filesCount})` : "Фото"}
                  </Button>
                </>
              ) : null}
              <Button
                size="lg"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await changeTaskStatus(task.id, "DONE");
                    if (result.ok) {
                      toast.success("Выполнено!");
                    } else {
                      toast.error(result.error ?? "Ошибка");
                    }
                  })
                }
              >
                <Check className="size-4" /> Выполнено
              </Button>
            </>
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
    </div>
  );
}
