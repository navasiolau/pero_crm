"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { assignOrdinaryExpenseProject } from "@/server/payments/project-assignment-actions";

const NO_PROJECT = "@no-project";

export function ExpenseProjectAssignmentDialog({ paymentId, currentProjectId, expectedHead, projects, onApplied }: {
  paymentId: string;
  currentProjectId: string | null;
  expectedHead: string | null;
  projects: readonly { id: string; number: string; title: string }[];
  onApplied: () => void;
}) {
  const router = useRouter();
  const labelId = useId();
  const initial = currentProjectId ?? NO_PROJECT;
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function changeOpen(next: boolean) {
    if (pending) return;
    if (next) {
      setTarget(initial);
      setError("");
    }
    setOpen(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || target === initial) return;
    setPending(true);
    setError("");
    try {
      const result = await assignOrdinaryExpenseProject({
        paymentId, expectedProjectId: currentProjectId, expectedHead, projectId: target === NO_PROJECT ? null : target,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      onApplied();
      router.refresh();
      toast.success("Назначение расхода обновлено");
    } catch {
      setError("Не удалось подтвердить изменение проекта. Обновите карточку и проверьте расход");
    } finally {
      setPending(false);
    }
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger render={<Button type="button" variant="outline"/>}>
      {currentProjectId ? "Изменить проект" : "Назначить на проект"}
    </DialogTrigger>
    <DialogContent>
      <form onSubmit={submit} className="space-y-4">
        <DialogHeader>
          <DialogTitle>{currentProjectId ? "Изменить проект расхода" : "Назначить расход на проект"}</DialogTitle>
          <DialogDescription>Расход будет учтён в выбранном проекте. Сумма списания и остаток кассы сохранятся.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor={labelId} className="text-sm font-medium">Проект</label>
          <SearchableSelect id={labelId} value={target} onChange={setTarget} disabled={pending} wrapOptions searchPlaceholder="Поиск по номеру и названию"
            options={[{ value: NO_PROJECT, label: "Без проекта" }, ...projects.map(project => ({ value: project.id, label: project.number + " · " + project.title }))]}/>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => changeOpen(false)}>Отмена</Button>
          <Button type="submit" disabled={pending || target === initial}>{pending ? "Сохраняем…" : "Сохранить"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
