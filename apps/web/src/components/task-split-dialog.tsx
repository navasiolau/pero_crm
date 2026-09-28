"use client";

import { useEffect, useId, useRef, useState } from "react";
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import { personalQuantity, sharePercent, splitAllocation } from "@/lib/work-shares";
import { getTaskSplitOptions, splitTask } from "@/server/tasks/share-actions";

type SplitOptions = Extract<Awaited<ReturnType<typeof getTaskSplitOptions>>, { ok: true }>;
type SplitTask = { id: string; title: string };
type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: SplitOptions };

function displayDecimal(value: string): string {
  const [integer, fraction] = value.split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0")}${fraction ? `,${fraction}` : ""}`;
}

function createRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Локальный CRM может открываться по HTTP, где randomUUID недоступен.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function SharePreview({
  title,
  name,
  units,
  amount,
  currency,
  quantity,
}: {
  title: string;
  name: string;
  units: number;
  amount: string;
  currency: string | null;
  quantity: string | null;
}) {
  const ownQuantity = personalQuantity({
    quantity,
    executorShare: "1",
    allocationGroupId: "preview",
    shareUnits: units,
    shareAmount: amount,
  });

  return (
    <div className="min-w-0 rounded-lg border p-3">
      <div className="font-medium">{title}</div>
      <div className="break-words text-sm text-muted-foreground">{name}</div>
      <dl className="mt-2 flex flex-col gap-1 text-sm">
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt>Доля задачи</dt>
          <dd className="font-medium tabular-nums">{displayDecimal(sharePercent(units))}%</dd>
        </div>
        {ownQuantity !== null ? (
          <div className="flex flex-wrap justify-between gap-x-3">
            <dt>Личный объём</dt>
            <dd className="font-medium tabular-nums">{displayDecimal(ownQuantity)} ед.</dd>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt>Сумма доли</dt>
          <dd className="font-medium tabular-nums">
            {currency ? `${displayDecimal(amount)} ${currency}` : "Без денежного начисления"}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function TaskSplitForm({
  task,
  onClose,
  onDone,
}: {
  task: SplitTask;
  onClose: () => void;
  onDone: () => void;
}) {
  const percentId = useId();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [recipientId, setRecipientId] = useState("");
  const [percent, setPercent] = useState("50");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const submitting = useRef(false);
  const request = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    setLoad({ status: "loading" });
    void getTaskSplitOptions(task.id).then((result) => {
      if (cancelled) return;
      setLoad(result.ok
        ? { status: "ready", data: result }
        : { status: "error", error: result.error });
    }).catch(() => {
      if (!cancelled) setLoad({ status: "error", error: "Не удалось загрузить данные задачи. Повторите попытку." });
    });
    return () => {
      cancelled = true;
      active.current = false;
    };
  }, [task.id, reload]);

  const data = load.status === "ready" ? load.data : null;
  const recipient = data?.options.find((option) => option.id === recipientId);
  let preview: ReturnType<typeof splitAllocation> | null = null;
  let percentError: string | null = null;
  if (data) {
    try {
      const normalizedPercent = percent.trim().replace(",", ".");
      if (!/^\d+(?:\.\d{1,2})?$/.test(normalizedPercent)) {
        throw new Error("Укажите процент от 0,01 до 99,99, не более двух знаков после запятой");
      }
      preview = splitAllocation(data.share.units, data.share.amount, normalizedPercent);
    } catch (cause) {
      percentError = cause instanceof Error ? cause.message : "Проверьте передаваемый процент";
    }
  }

  async function submit() {
    if (submitting.current || !data || !preview || !recipient || recipient.disabledReason) return;
    // Один UUID переживает сетевой сбой; изменение формы начинает новую попытку.
    const key = JSON.stringify([task.id, recipientId, preview.percent, data.share.revision]);
    if (request.current?.key !== key) request.current = { key, id: createRequestId() };
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await splitTask({
        taskId: task.id,
        recipientId,
        percent: preview.percent,
        expectedRevision: data.share.revision,
        requestId: request.current.id,
      });
      if (!active.current) return;
      if (result.ok) {
        toast.success("Задача разделена");
        onClose();
        onDone();
      } else {
        setError(result.error ?? "Не удалось разделить задачу");
      }
    } catch {
      if (active.current) setError("Не удалось подтвердить разделение. Повторите попытку с теми же данными.");
    } finally {
      submitting.current = false;
      if (active.current) setPending(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Разделить задачу</DialogTitle>
        <DialogDescription className="break-words">{task.title}</DialogDescription>
      </DialogHeader>

      {load.status === "loading" ? (
        <p role="status" className="text-sm text-muted-foreground">Загружаем актуальную долю и сотрудников…</p>
      ) : load.status === "error" ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm text-destructive">{load.error}</p>
          <Button variant="outline" onClick={() => setReload((value) => value + 1)}>Повторить загрузку</Button>
        </div>
      ) : data ? (
        <div className="flex min-w-0 flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Текущая доля {data.assigneeName}: {displayDecimal(sharePercent(data.share.units))}%.
            Передаваемый процент считается от этой доли.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label>Кому передать часть задачи</Label>
            <SearchableSelect
              options={data.options.map((option) => ({
                value: option.id,
                label: option.name,
                hint: [option.disabledReason, option.hint].filter(Boolean).join(" · "),
                disabled: !!option.disabledReason,
              }))}
              value={recipientId}
              onChange={(value) => {
                if (value !== recipientId) request.current = null;
                setRecipientId(value);
                setError(null);
              }}
              disabled={pending}
              placeholder="Выберите сотрудника"
              searchPlaceholder="Поиск по имени или роли…"
              emptyText="Сотрудники не найдены"
            />
            {!data.options.some((option) => !option.disabledReason) ? (
              <p className="text-sm text-muted-foreground">Сейчас нет другого сотрудника с доступом к этой задаче.</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={percentId}>Передать от текущей доли, %</Label>
            <Input
              id={percentId}
              type="text"
              inputMode="decimal"
              value={percent}
              disabled={pending}
              aria-invalid={!!percentError}
              aria-describedby={`${percentId}-hint`}
              onChange={(event) => {
                if (event.target.value !== percent) request.current = null;
                setPercent(event.target.value);
                setError(null);
              }}
            />
            <p id={`${percentId}-hint`} className={percentError ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
              {percentError ?? "От 0,01 до 99,99%, не более двух знаков после запятой"}
            </p>
          </div>

          {preview ? (
            <div className="flex flex-col gap-2" aria-live="polite">
              <SharePreview
                title="Останется исходному исполнителю"
                name={data.assigneeName}
                units={preview.remainingUnits}
                amount={preview.remainingAmount}
                currency={data.share.currency}
                quantity={data.share.quantity}
              />
              <SharePreview
                title="Будет передано"
                name={recipient?.name ?? "Выберите сотрудника"}
                units={preview.transferredUnits}
                amount={preview.transferredAmount}
                currency={data.share.currency}
                quantity={data.share.quantity}
              />
            </div>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Записанное время, активный таймер и фотографии останутся у исходной задачи.
            Коллега получит новую задачу в статусе «Новая» без записанного времени и фотографий.
          </p>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
      ) : null}

      <DialogFooter>
        <Button size="lg" variant="outline" onClick={onClose}>Отмена</Button>
        <Button
          size="lg"
          disabled={pending || !preview || !recipient || !!recipient.disabledReason}
          onClick={() => void submit()}
        >
          {pending ? "Разделение…" : "Разделить задачу"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function TaskSplitDialog({
  task,
  open,
  onOpenChange,
  onDone,
}: {
  task: SplitTask | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  return (
    <Dialog open={open && !!task} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Каждое открытие и смена задачи создают новую форму и UUID запроса. */}
        {open && task ? (
          <TaskSplitForm key={task.id} task={task} onClose={() => onOpenChange(false)} onDone={onDone} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
