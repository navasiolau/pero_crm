"use client";

import React from "react";
import type { EngineeringFundView, EngineeringTaskView } from "@/lib/engineering-fund-view";
import { percentToStageUnits } from "@/lib/engineering-fund-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Worker = { id: string; name: string };
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

export function EngineeringFund({view}: {view: EngineeringFundView; canManage: boolean; workers: Worker[]}) {
  return <section className="min-w-0 space-y-4"><EngineeringFundSummary view={view} /><WorkDetails view={view} /></section>;
}
