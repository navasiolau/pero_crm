'use client';
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { getTaskReassignmentOptions, reassignOrdinaryTask } from "@/server/tasks/task-reassignment-actions";
import type { TaskReassignmentInput, TaskReassignmentOptions } from "@/server/tasks/task-reassignment-core";

type Options = Extract<TaskReassignmentOptions, { ok: true }>;
export function TaskReassignmentButton({ taskId, disabled, onDone }: { taskId: string; disabled?: boolean; onDone?: () => void }) {
  const [options, setOptions] = useState<Options | null>(null), [pending, startTransition] = useTransition();
  function open() { startTransition(async () => {
    try { const result = await getTaskReassignmentOptions(taskId); if (result.ok) setOptions(result); else toast.error(result.error); }
    catch { toast.error("Не удалось открыть переназначение"); }
  }); }
  return <><Button variant="outline" size="sm" disabled={disabled || pending} onClick={open}>Переназначить</Button>
    {options ? <TaskReassignmentDialog key={options.taskId + ":" + options.expectedRevision} options={options} onClose={() => setOptions(null)} onDone={onDone} /> : null}</>;
}

export function TaskReassignmentDialog({ options, onClose, onDone }: { options: Options; onClose: () => void; onDone?: () => void }) {
  const router = useRouter(), [assigneeId, setAssigneeId] = useState(""), [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition(), [uncertain, setUncertain] = useState(false);
  const request = useRef<TaskReassignmentInput | null>(null), submitting = useRef(false);
  const locked = pending || uncertain;
  function submit() {
    if (submitting.current) return;
    const input = request.current ?? Object.freeze({ taskId: options.taskId, assigneeId, expectedRevision: options.expectedRevision, clientMutationId: crypto.randomUUID() });
    request.current = input; submitting.current = true; setError(null);
    startTransition(async () => {
      try {
        const result = await reassignOrdinaryTask(input);
        if (result.ok) { request.current = null; toast.success("Задача переназначена"); onClose(); onDone?.(); router.refresh(); return; }
        setError(result.error);
        if (result.kind === "failure") setUncertain(true); else { request.current = null; setUncertain(false); }
      } catch { setUncertain(true); setError("Ответ не получен. Повторите тот же запрос для подтверждения назначения."); }
      finally { submitting.current = false; }
    });
  }
  return <Dialog open onOpenChange={open => { if (!open && !locked) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>Переназначить задачу</DialogTitle></DialogHeader>
    <p className="break-words text-sm">{options.title}</p>
    <p className="text-sm text-muted-foreground">Весь объём задачи перейдёт новому исполнителю, статус станет «Новая». Чтобы оставить часть прежнему исполнителю, сначала разделите задачу.</p>
    <fieldset disabled={locked} className="space-y-2"><Label>Новый исполнитель</Label>
      <SearchableSelect options={options.recipients.filter(user => user.value !== options.assigneeId)} value={assigneeId} onChange={setAssigneeId} disabled={locked} placeholder="Выберите исполнителя…" searchPlaceholder="Поиск сотрудника…" />
    </fieldset>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <DialogFooter><Button variant="outline" disabled={locked} onClick={onClose}>Отмена</Button>
      <Button disabled={pending || (!uncertain && (!assigneeId || assigneeId === options.assigneeId))} onClick={submit}>{uncertain ? "Повторить тот же запрос" : pending ? "Переназначаем…" : "Переназначить"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
