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
import { previewStageSplit } from "@/lib/product-stage-split-preview";
import { createRequestId } from "@/lib/request-id";
import { getTaskSplitOptions, splitTask } from "@/server/tasks/share-actions";

type SplitOptions = Extract<Awaited<ReturnType<typeof getTaskSplitOptions>>, { ok: true }>;
type SplitTask = { id: string; title: string };
type SplitPreview = {
  percent: string; remainingUnits: number; transferredUnits: number;
  remainingAmount: string | null; transferredAmount: string | null;
  remainingStageUnits?: number; transferredStageUnits?: number;
};
type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: SplitOptions };

function displayDecimal(value: string): string {
  const [integer, fraction] = value.split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0")}${fraction ? `,${fraction}` : ""}`;
}

function SharePreview({
  title,
  name,
  units,
  amount,
  currency,
  quantity,
  stageUnits,
  engineering,
  installation,
}: {
  title: string;
  name: string;
  units: number;
  amount: string | null;
  currency: string | null;
  quantity: string | null;
  stageUnits?: number;
  engineering: boolean;
  installation: boolean;
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
          <dt>{installation ? "Физическая доля задачи" : engineering ? "Доля физического объёма" : "Доля задачи"}</dt>
          <dd className="font-medium tabular-nums">{displayDecimal(sharePercent(units))}%</dd>
        </div>
        {stageUnits !== undefined ? <div className="flex flex-wrap justify-between gap-x-3">
          <dt>Доля оплаты работы</dt><dd className="font-medium tabular-nums">{displayDecimal(sharePercent(stageUnits))}%</dd>
        </div> : null}
        {ownQuantity !== null ? (
          <div className="flex flex-wrap justify-between gap-x-3">
            <dt>Личный объём</dt>
            <dd className="font-medium tabular-nums">{displayDecimal(ownQuantity)} ед.</dd>
          </div>
        ) : null}
        {!installation ? <div className="flex flex-wrap justify-between gap-x-3">
          <dt>{engineering ? "Предварительная сумма" : "Сумма доли"}</dt>
          <dd className="font-medium tabular-nums">
            {amount === null ? "Пока не рассчитана" : currency ? `${engineering ? "≈ " : ""}${displayDecimal(amount)} ${currency}` : "Без денежного начисления"}
          </dd>
        </div> : null}
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
  let preview: SplitPreview | null = null;
  let percentError: string | null = null;
  if (data) {
    try {
      const normalizedPercent = percent.trim().replace(",", ".");
      if (!/^\d+(?:\.\d{1,2})?$/.test(normalizedPercent)) {
        throw new Error("Укажите процент от 0,01 до 99,99, не более двух знаков после запятой");
      }
      if (data.share.source === "ENGINEERING") {
        if (data.share.stageUnits === null) throw new Error("Финансовая доля ещё не задана");
        preview = previewStageSplit(task.id, data.share.units, data.share.stageUnits, normalizedPercent, data.share.engineeringPreview);
      } else if (data.share.source === "INSTALLATION") {
        preview = splitAllocation(data.share.units, "0.00", normalizedPercent);
      } else {
        if (data.share.amount === null) throw new Error("Не задан бюджет обычной задачи");
        preview = splitAllocation(data.share.units, data.share.amount, normalizedPercent);
      }
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
            Текущая {data.share.source === "INSTALLATION" ? "физическая доля задачи" : data.share.source === "ENGINEERING" ? "доля физического объёма" : "доля задачи"} {data.assigneeName}: {displayDecimal(sharePercent(data.share.units))}%.
            Передаваемый процент считается от этой доли.
          </p>
          {data.share.source === "INSTALLATION" ? <p className="text-sm text-muted-foreground">
            Передаётся только физическая доля задачи. Денежное участие в монтаже меняется отдельно в карточке процентных этапов изделия.
          </p> : null}
          {data.share.source === "ENGINEERING" ? <p className="text-sm text-muted-foreground">
            Сейчас доля оплаты работы — {data.share.stageUnits === null ? "не задана" : `${displayDecimal(sharePercent(data.share.stageUnits))}%`}.
            Предварительные суммы пересчитываются по всему фонду и фиксируются при передаче изделия в производство.
            {data.share.previewReason ? ` ${data.share.previewReason}.` : ""}
          </p> : null}
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
            <Label htmlFor={percentId}>{data.share.source === "INSTALLATION" ? "Передать от текущей физической доли, %" : "Передать от текущей доли, %"}</Label>
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
              {percentError ?? (data.share.source === "INSTALLATION" ? "Физическое распределение задачи; это не денежная доля этапа изделия." : "От 0,01 до 99,99%, не более двух знаков после запятой")}
            </p>
          </div>

          {preview ? (
            <div className="flex flex-col gap-2" aria-live="polite">
              <SharePreview
                title="Останется исходному исполнителю"
                name={data.assigneeName}
                units={preview.remainingUnits}
                amount={preview.remainingAmount}
                currency={data.share.previewCurrency ?? data.share.currency}
                quantity={data.share.quantity}
                engineering={data.share.source === "ENGINEERING"}
                installation={data.share.source === "INSTALLATION"}
                stageUnits={preview.remainingStageUnits}
              />
              <SharePreview
                title="Будет передано"
                name={recipient?.name ?? "Выберите сотрудника"}
                units={preview.transferredUnits}
                amount={preview.transferredAmount}
                currency={data.share.previewCurrency ?? data.share.currency}
                quantity={data.share.quantity}
                engineering={data.share.source === "ENGINEERING"}
                installation={data.share.source === "INSTALLATION"}
                stageUnits={preview.transferredStageUnits}
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
