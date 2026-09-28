"use client";

import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { EngineeringFundView, EngineeringTaskView } from "@/lib/engineering-fund-view";
import { percentToStageUnits } from "@/lib/engineering-fund-view";
import { createRequestId } from "@/lib/request-id";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { closeEngineeringStageAction, configureEngineeringPoolAction, configureEngineeringTaskSharesAction,
  convertUnpaidWorkToEngineeringAction, createEngineeringWorkAction } from "@/server/product-stage-pay/actions";

type Worker = { id: string; name: string };
const fundActionClass = "h-auto min-h-12 w-full max-w-full whitespace-normal py-3 leading-snug sm:w-auto";
const percentOf = (units: number | null): string => units === null ? "" : (units / 10_000).toFixed(4).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");

export function parseFundRate(value: string): string | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(normalized) || Number(normalized) > 100)
    throw new Error("Ставка должна быть от 0 до 100 процентов, не более двух знаков после запятой");
  return normalized;
}

type ConversionPayload = { productId: string; poolId: string; workId: string; expectedPoolRevision: number;
  poolWeights: { workId: string; units: number }[]; taskShares: { taskId: string; units: number; expectedRevision: number }[] };

export function conversionRequestKey(payload: ConversionPayload): string {
  return JSON.stringify({ productId: payload.productId, poolId: payload.poolId, workId: payload.workId,
    expectedPoolRevision: payload.expectedPoolRevision,
    poolWeights: [...payload.poolWeights].sort((a, b) => a.workId.localeCompare(b.workId)),
    taskShares: [...payload.taskShares].sort((a, b) => a.taskId.localeCompare(b.taskId)) });
}

export function parseFullStageMapping(ids: readonly string[], values: Record<string, string>): { id: string; units: number }[] {
  if (new Set(ids).size !== ids.length || Object.keys(values).length !== ids.length ||
    ids.some((id) => !Object.hasOwn(values, id) || !values[id].trim())) throw new Error("Укажите доли всех участников распределения");
  if (ids.length === 0) return [];
  const rows = ids.map((id) => ({ id, units: percentToStageUnits(values[id]) }));
  if (rows.reduce((sum, row) => sum + row.units, 0) !== 1_000_000) throw new Error("Сумма долей должна составлять ровно 100% ");
  return rows;
}

export function initialConversionTaskPercents(tasks: readonly Pick<EngineeringTaskView, "id">[]): Record<string, string> {
  return Object.fromEntries(tasks.map((task) => [task.id, tasks.length === 1 ? "100" : ""]));
}

function amountLabel(amount: string | null, currency: string | null) {
  return amount === null ? "Сумма пока не рассчитана" : `${amount} ${currency ?? ""}`.trim();
}

export function EngineeringFundSummary({ view }: { view: EngineeringFundView }) {
  const protectedLegacy = view.state === "LEGACY_PROTECTED";
  return <Card className="min-w-0" aria-label="Инженерный фонд изделия">
    <CardHeader><CardTitle>Инженерный фонд изделия</CardTitle></CardHeader>
    <CardContent className="min-w-0 space-y-2 break-words">
      {view.state === "ABSENT" && <p>Фонд ещё не настроен.</p>}
      {protectedLegacy && <p>Изделие защищено историческим начислением. Индивидуальная сумма по изделию неизвестна.</p>}
      {(view.state === "DRAFT" || view.state === "SETTLED") && <>
        <p>Ставка: {view.ratePercent === null ? "Ставка не задана" : `${view.ratePercent}%`}</p>
        <p>База: {view.priceBasis === null ? "Цена изделия не задана" : `${view.priceBasis} ${view.productCurrency}`}</p>
        <p className="text-base font-medium">{view.state === "SETTLED" ? "Начислено" : "Предварительная сумма"}: {view.amount === null ? "пока не рассчитана" : `${view.state === "DRAFT" ? "≈ " : ""}${amountLabel(view.amount, view.currency)}`}</p>
        {view.state === "SETTLED" && view.closedAt && <p>Дата начисления: {view.closedAt.slice(0, 10)}</p>}
        {view.state === "DRAFT" && view.previewReason && <p className="text-muted-foreground">{view.previewReason}</p>}
      </>}
    </CardContent>
  </Card>;
}

function PercentField({ id, label, value, onChange, disabled = false, precision = 4 }: { id: string; label: string; value: string; onChange: (value: string) => void; disabled?: boolean; precision?: 2 | 4 }) {
  return <div className="min-w-0 space-y-1">
    <label htmlFor={id} className="block text-sm font-medium">{label}</label>
    <Input id={id} type="text" inputMode="decimal" className="h-12 min-w-0" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} aria-describedby={`${id}-hint`} />
    <span id={`${id}-hint`} className="text-xs text-muted-foreground">Процент от 0 до 100, до {precision === 2 ? "двух" : "четырёх"} знаков</span>
  </div>;
}

function WorkDetails({ view }: { view: EngineeringFundView }) {
  if (!view.works.length) return <p className="text-sm text-muted-foreground">Инженерных работ пока нет.</p>;
  return <div className="space-y-3">
    {view.works.map((work) => <Card key={work.id} className="min-w-0" size="sm">
      <CardHeader><CardTitle className="break-words">{work.title}</CardTitle></CardHeader>
      <CardContent className="min-w-0 space-y-2 break-words">
        <p>Вес работы в фонде: {percentOf(work.weightUnits)}%</p>
        <p>Физический объём работы: {work.quantity}</p>
        <p>{view.state === "SETTLED" ? "Начислено за работу" : "Предварительно за работу"}: {work.amount === null ? "пока не рассчитано" : `${view.state === "DRAFT" ? "≈ " : ""}${amountLabel(work.amount, view.currency)}`}</p>
        <div className="space-y-2">
          {work.tasks.map((task) => <div key={task.id} className="min-w-0 rounded-lg border p-3">
            <p className="font-medium break-words">{task.title} · {task.assigneeName ?? "Исполнитель не назначен"}</p>
            <p>Физический объём задачи: {task.quantity ?? "не задан"}</p>
            <p>Финансовая доля задачи в работе: {task.units === null ? "не задана" : `${percentOf(task.units)}%`}</p>
            <p>{view.state === "SETTLED" ? "Начислено задаче" : "Предварительно задаче"}: {task.amount === null ? "пока не рассчитано" : `${view.state === "DRAFT" ? "≈ " : ""}${amountLabel(task.amount, view.currency)}`}</p>
            <p className="text-xs text-muted-foreground">Статус: {task.status === "DONE" ? "Выполнена" : task.status === "IN_PROGRESS" ? "В работе" : task.status === "DRAFT" ? "Черновик" : "Новая"}</p>
          </div>)}
        </div>
      </CardContent>
    </Card>)}
  </div>;
}

function EngineeringFundInner({ view, canManage, workers }: { view: EngineeringFundView; canManage: boolean; workers: Worker[] }) {
  const router = useRouter();
  const editable = canManage && view.productStatus === "DESIGN" && (view.state === "ABSENT" || view.state === "DRAFT");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState(view.ratePercent ?? "");
  const [weights, setWeights] = useState<Record<string, string>>(() => Object.fromEntries(view.works.map((work) => [work.id, percentOf(work.weightUnits)])));
  const [taskShares, setTaskShares] = useState<Record<string, string>>(() => Object.fromEntries(view.works.flatMap((work) => work.tasks.map((task) => [task.id, percentOf(task.units)]))));
  const [newTitle, setNewTitle] = useState("");
  const [newQuantity, setNewQuantity] = useState("1");
  const [newAssignee, setNewAssignee] = useState(view.primaryEngineerId && workers.some((worker) => worker.id === view.primaryEngineerId) ? view.primaryEngineerId : "");
  const [newDueDate, setNewDueDate] = useState("");
  const [newEstimate, setNewEstimate] = useState("");
  const [newWeight, setNewWeight] = useState(view.works.length ? "0" : "100");
  const [candidateId, setCandidateId] = useState("");
  const [conversionWeight, setConversionWeight] = useState(view.works.length ? "0" : "100");
  const [conversionShares, setConversionShares] = useState<Record<string, string>>({});
  const [confirmClose, setConfirmClose] = useState(false);
  const conversionIds = useRef(new Map<string, string>());
  const closeId = useRef<string | null>(null);
  const submittedConversion = useRef(new Set<string>());
  const created = useRef(false);
  const closed = useRef(false);

  async function perform(operation: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await operation();
      if (!result.ok) throw new Error(result.error ?? "Не удалось сохранить изменения");
      after?.();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить изменения");
    } finally { busyRef.current = false; setBusy(false); }
  }

  const workIds = view.works.map((work) => work.id);
  function currentWeights(extra?: { id: string; value: string }) {
    const rows = parseFullStageMapping(extra ? [...workIds, extra.id] : workIds, extra ? { ...weights, [extra.id]: extra.value } : weights);
    return rows.map((row) => ({ workId: row.id, units: row.units }));
  }
  const selectedCandidate = view.candidates.find((candidate) => candidate.id === candidateId) ?? null;

  return <section className="min-w-0 space-y-4" aria-label="Инженерный фонд">
    <EngineeringFundSummary view={view} />
    {error && <p role="alert" className="rounded-lg border border-destructive/50 p-3 text-destructive break-words">{error}</p>}
    {view.state !== "ABSENT" && view.state !== "LEGACY_PROTECTED" && <WorkDetails view={view} />}
    {editable && <>
      <Card className="min-w-0">
        <CardHeader><CardTitle>{view.state === "ABSENT" ? "Включить инженерный фонд" : "Настроить ставку и веса работ"}</CardTitle></CardHeader>
        <CardContent className="min-w-0 space-y-4">
          <PercentField id="engineering-rate" label="Ставка фонда, % (пусто — не задана)" value={rate} onChange={setRate} disabled={busy} precision={2} />
          {view.works.map((work) => <PercentField key={work.id} id={`engineering-weight-${work.id}`} label={`Вес работы «${work.title}» в фонде, %`} value={weights[work.id] ?? ""}
            onChange={(value) => setWeights((previous) => ({ ...previous, [work.id]: value }))} disabled={busy} />)}
          <p className="text-xs text-muted-foreground">Веса всех работ при сохранении должны составлять ровно 100%. Нулевой вес допустим.</p>
          <Button type="button" className={fundActionClass} disabled={busy} onClick={() => {
            try { const workWeights = currentWeights(); const ratePercent = parseFundRate(rate); void perform(() => configureEngineeringPoolAction({ productId: view.productId,
              ratePercent, workWeights, expectedPoolRevision: view.revision })); }
            catch (cause) { setError(cause instanceof Error ? cause.message : "Проверьте веса работ"); }
          }}>{view.state === "ABSENT" ? "Включить фонд" : "Сохранить ставку и веса"}</Button>
        </CardContent>
      </Card>

      {view.state === "DRAFT" && view.works.map((work) => <Card key={`edit-${work.id}`} className="min-w-0">
        <CardHeader><CardTitle className="break-words">Финансовые доли задач · {work.title}</CardTitle></CardHeader>
        <CardContent className="min-w-0 space-y-4">
          <p className="text-sm text-muted-foreground">Задайте оплату отдельно от физического объёма. Выполненную неоплаченную задачу можно включить в распределение.</p>
          {work.tasks.map((task) => <div key={task.id} className="min-w-0 rounded-lg border p-3 space-y-2">
            <p className="break-words">{task.title} · физический объём: {task.quantity ?? "не задан"}</p>
            <PercentField id={`engineering-task-${task.id}`} label={`Финансовая доля задачи «${task.title}» в работе, %`}
              value={taskShares[task.id] ?? ""} onChange={(value) => setTaskShares((previous) => ({ ...previous, [task.id]: value }))} disabled={busy} />
          </div>)}
          <Button type="button" className={fundActionClass} disabled={busy || work.tasks.length === 0} onClick={() => {
            try {
              const shares = parseFullStageMapping(work.tasks.map((task) => task.id), Object.fromEntries(work.tasks.map((task) => [task.id, taskShares[task.id] ?? ""])));
              void perform(() => configureEngineeringTaskSharesAction({ productId: view.productId, workId: work.id,
                shares: shares.map((row) => ({ taskId: row.id, units: row.units, expectedRevision: work.tasks.find((task) => task.id === row.id)!.revision })),
                expectedPoolRevision: view.revision }));
            } catch (cause) { setError(cause instanceof Error ? cause.message : "Проверьте доли задач"); }
          }}>Сохранить доли задач</Button>
        </CardContent>
      </Card>)}

      {view.state === "DRAFT" && <Card className="min-w-0">
        <CardHeader><CardTitle>Новая инженерная работа</CardTitle></CardHeader>
        <CardContent className="min-w-0 space-y-4">
          <div className="space-y-1"><label htmlFor="engineering-new-title" className="font-medium">Название работы и задачи</label>
            <Input id="engineering-new-title" className="h-12" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} disabled={busy} /></div>
          <p className="text-sm text-muted-foreground">Тип задачи: Проектирование</p>
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 [&>div]:min-w-0">
            <div className="space-y-1"><label htmlFor="engineering-new-quantity" className="font-medium">Физическое количество</label>
              <Input id="engineering-new-quantity" className="h-12" inputMode="decimal" value={newQuantity} onChange={(event) => setNewQuantity(event.target.value)} disabled={busy} /></div>
            <div className="space-y-1" role="group" aria-label="Исполнитель новой инженерной задачи"><span className="block font-medium">Исполнитель</span>
              <SearchableSelect options={workers.map((worker) => ({ value: worker.id, label: worker.name }))} value={newAssignee} onChange={setNewAssignee}
                placeholder="Выберите сотрудника" disabled={busy} className="min-h-12" /></div>
            <div className="space-y-1"><label htmlFor="engineering-new-due" className="font-medium">Срок задачи</label>
              <Input id="engineering-new-due" type="date" className="h-12" value={newDueDate} onChange={(event) => setNewDueDate(event.target.value)} disabled={busy} /></div>
            <div className="space-y-1"><label htmlFor="engineering-new-estimate" className="font-medium">Оценка времени, минут</label>
              <Input id="engineering-new-estimate" type="number" min="1" step="1" className="h-12" value={newEstimate} onChange={(event) => setNewEstimate(event.target.value)} disabled={busy} /></div>
          </div>
          <PercentField id="engineering-new-weight" label="Вес новой работы в фонде, %" value={newWeight} onChange={setNewWeight} disabled={busy} />
          <p className="text-xs text-muted-foreground">Веса существующих работ берутся из полей настройки выше. Вместе с новой работой они должны составить 100%.</p>
          <Button type="button" className={fundActionClass} disabled={busy || created.current} onClick={() => {
            try {
              if (!newTitle.trim() || !newAssignee || !newDueDate || !/^\d+$/.test(newEstimate) || Number(newEstimate) < 1) throw new Error("Заполните название, исполнителя, срок и оценку задачи");
              const poolWeights = currentWeights({ id: "__new__", value: newWeight });
              void perform(() => createEngineeringWorkAction({ productId: view.productId, title: newTitle.trim(), quantity: newQuantity.trim().replace(",", "."),
                assigneeId: newAssignee, dueAt: new Date(`${newDueDate}T12:00:00.000Z`), estimateMinutes: Number(newEstimate), poolWeights,
                expectedPoolRevision: view.revision }), () => { created.current = true; });
            } catch (cause) { setError(cause instanceof Error ? cause.message : "Проверьте данные работы"); }
          }}>Добавить инженерную работу</Button>
        </CardContent>
      </Card>}

      {view.state === "DRAFT" && view.poolId && view.candidates.length > 0 && <Card className="min-w-0">
        <CardHeader><CardTitle>Перевести неоплаченную работу</CardTitle></CardHeader>
        <CardContent className="min-w-0 space-y-4">
          <div role="group" aria-label="Работа для перевода"><span className="block font-medium">Существующая работа</span>
            <SearchableSelect options={view.candidates.map((candidate) => ({ value: candidate.id, label: candidate.title, hint: candidate.disabledReason ?? undefined,
              disabled: !!candidate.disabledReason }))} value={candidateId} onChange={(id) => {
                setCandidateId(id);
                const candidate = view.candidates.find((row) => row.id === id);
                setConversionShares(candidate ? initialConversionTaskPercents(candidate.tasks) : {});
              }} placeholder="Выберите работу" disabled={busy} className="min-h-12" /></div>
          {selectedCandidate && <>
            <p>Физический объём работы: {selectedCandidate.quantity}. Финансовые доли задаются отдельно.</p>
            <PercentField id="engineering-conversion-weight" label="Вес переводимой работы в фонде, %" value={conversionWeight} onChange={setConversionWeight} disabled={busy} />
            {selectedCandidate.tasks.map((task) => <PercentField key={task.id} id={`engineering-convert-task-${task.id}`}
              label={`Финансовая доля задачи «${task.title}» в работе, % (физический объём ${task.quantity ?? "не задан"})`}
              value={conversionShares[task.id] ?? ""} onChange={(value) => setConversionShares((previous) => ({ ...previous, [task.id]: value }))} disabled={busy} />)}
            {selectedCandidate.tasks.length > 1 && <p className="text-xs text-muted-foreground">Для нескольких задач укажите каждую долю вручную. Количество не определяет оплату.</p>}
            <Button type="button" className={fundActionClass} disabled={busy || !!selectedCandidate.disabledReason || submittedConversion.current.has(selectedCandidate.id)} onClick={() => {
              try {
                const taskShares = parseFullStageMapping(selectedCandidate.tasks.map((task) => task.id), conversionShares).map((row) => ({
                  taskId: row.id, units: row.units, expectedRevision: selectedCandidate.tasks.find((task) => task.id === row.id)!.revision }));
                const poolWeights = currentWeights({ id: selectedCandidate.id, value: conversionWeight });
                const payload = { productId: view.productId, workId: selectedCandidate.id, poolId: view.poolId!,
                  poolWeights, taskShares, expectedPoolRevision: view.revision };
                const key = conversionRequestKey(payload);
                const requestId = conversionIds.current.get(key) ?? createRequestId();
                conversionIds.current.set(key, requestId);
                void perform(() => convertUnpaidWorkToEngineeringAction({ ...payload, requestId }), () => submittedConversion.current.add(selectedCandidate.id));
              } catch (cause) { setError(cause instanceof Error ? cause.message : "Проверьте распределение работы"); }
            }}>Перевести работу в инженерный фонд</Button>
          </>}
        </CardContent>
      </Card>}

      {view.state === "DRAFT" && <>
        <Button type="button" className={fundActionClass} disabled={busy || !view.canClose || closed.current} onClick={() => setConfirmClose(true)}>
          Передать в производство и начислить фонд
        </Button>
        <Dialog open={confirmClose} onOpenChange={setConfirmClose}>
          <DialogContent className="min-w-0 sm:max-w-lg">
            <DialogHeader><DialogTitle>Подтвердить передачу в производство</DialogTitle>
              <DialogDescription>После подтверждения сумма, курс и доли станут неизменяемыми.</DialogDescription></DialogHeader>
            <div className="min-w-0 space-y-2 break-words">
              <p>Предварительный фонд: ≈ {amountLabel(view.amount, view.currency)}</p>
              <p>Цена изделия: {view.priceBasis ?? "не задана"} {view.productCurrency}</p>
              <p>Ставка: {view.ratePercent === null ? "не задана" : `${view.ratePercent}%`}</p>
              <p>Дата расчёта: {new Date().toLocaleDateString("ru-RU")}</p>
              {view.works.map((work) => <p key={work.id}>{work.title}: вес {percentOf(work.weightUnits)}%, {work.tasks.length} задач</p>)}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className={fundActionClass} onClick={() => setConfirmClose(false)}>Отмена</Button>
              <Button type="button" className={fundActionClass} disabled={busy || !view.canClose || closed.current} onClick={() => {
                const requestId = closeId.current ?? createRequestId();
                closeId.current = requestId;
                void perform(() => closeEngineeringStageAction({ productId: view.productId, expectedPoolRevision: view.revision, requestId }),
                  () => { closed.current = true; setConfirmClose(false); });
              }}>Подтвердить и начислить</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>}
    </>}
  </section>;
}

export function EngineeringFund(props: { view: EngineeringFundView; canManage: boolean; workers: Worker[] }) {
  return <EngineeringFundInner key={`${props.view.productId}:${props.view.state}:${props.view.revision}`} {...props} />;
}
