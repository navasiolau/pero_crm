"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { percentBps, percentLabel } from "./model";
import { readTripReallocation, readTripReallocationProducts, previewTripReallocation, saveTripReallocation } from "@/server/logistics/reallocation-actions";
import type { ReallocationInput } from "@/server/logistics/reallocation-contract";

type Details = Extract<Awaited<ReturnType<typeof readTripReallocation>>, { ok: true }>;
type Preview = Extract<Awaited<ReturnType<typeof previewTripReallocation>>, { ok: true }>;
type Line = { key: string; projectId: string; kind: "PRODUCT" | "MATERIAL"; entityId: string; quantity: string };

function label(number: string | null, title: string) {
  return number ? `${number} · ${title}` : title;
}

function ReallocationForm({ data, close, saved }: { data: Details; close: () => void; saved: () => void }) {
  const [shares, setShares] = useState(() => data.shares.map(share => ({ projectId: share.projectId, percent: String(share.percentBps / 100) })));
  const [lines, setLines] = useState<Line[]>(() => data.lines.map(line => ({
    key: `${line.projectId}:${line.kind}:${line.kind === "PRODUCT" ? line.productId : line.materialId}`,
    projectId: line.projectId, kind: line.kind,
    entityId: line.kind === "PRODUCT" ? line.productId : line.materialId, quantity: String(line.quantity),
  })));
  const [products, setProducts] = useState(data.products);
  const [preview, setPreview] = useState<{ output: Preview; input: ReallocationInput } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const projectLabel = (id: string) => {
    const row = data.projects.find(project => project.id === id);
    return row ? label(row.number, row.title) : "Проект недоступен";
  };
  function edited() { setPreview(null); setMessage(""); }
  async function addProject(id: string) {
    edited();
    setBusy(true);
    try {
      const result = await readTripReallocationProducts(id);
      if (!result.ok) { setMessage(result.message); return; }
      setProducts(previous => [...previous.filter(product => product.projectId !== id), ...result.products]);
      setShares(previous => [...previous, { projectId: id, percent: previous.length ? "" : "100" }]);
    } catch {
      setMessage("Не удалось загрузить изделия проекта");
    } finally { setBusy(false); }
  }
  function updateLine(key: string, patch: Partial<Line>) {
    edited();
    setLines(previous => previous.map(line => line.key === key ? { ...line, ...patch } : line));
  }
  async function calculate() {
    setBusy(true);
    setMessage("");
    const input: ReallocationInput = { ...data.version, requestId: crypto.randomUUID(),
      shares: shares.map(share => ({ projectId: share.projectId, percentBps: percentBps(share.percent) })),
      lines: lines.map(line => {
        const quantity = Number(line.quantity.trim().replace(",", "."));
        return line.kind === "PRODUCT" ? { projectId: line.projectId, kind: line.kind, productId: line.entityId, quantity }
          : { projectId: line.projectId, kind: line.kind, materialId: line.entityId, quantity };
      }),
    };
    try {
      const output = await previewTripReallocation(input);
      if (!output.ok) { setMessage(output.message); return; }
      setPreview({ input, output });
    } catch {
      setMessage("Не удалось рассчитать распределение");
    } finally { setBusy(false); }
  }
  async function save() {
    if (!preview || preview.output.noOp) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await saveTripReallocation(preview.input);
      if (!result.ok) { setMessage(result.message); return; }
      saved();
    } catch {
      setMessage("Не удалось подтвердить сохранение. Повторите тот же запрос");
    } finally { setBusy(false); }
  }

  return <>
    <div className="space-y-4">
      <p className="text-sm">Оплата от {data.date} · {data.cashName} · {data.amount} {data.currency} · {data.bynAmount} BYN</p>
      <SearchableSelect value="" placeholder="Добавить проект…" disabled={busy}
        options={data.projects.filter(project => !shares.some(share => share.projectId === project.id))
          .map(project => ({ value: project.id, label: label(project.number, project.title) }))}
        onChange={id => void addProject(id)} />
      {shares.map(share => <section key={share.projectId} className="space-y-3 rounded-xl border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 flex-1 font-medium">{projectLabel(share.projectId)}</h3>
          <label className="flex items-center gap-2 text-sm">Доля, % <Input className="w-24" inputMode="decimal" value={share.percent}
            disabled={busy} onChange={event => {
              edited();
              setShares(previous => previous.map(row => row.projectId === share.projectId ? { ...row, percent: event.target.value } : row));
            }} /></label>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => {
            edited();
            setShares(previous => previous.filter(row => row.projectId !== share.projectId));
            setLines(previous => previous.filter(line => line.projectId !== share.projectId));
          }}>Убрать проект</Button>
        </div>
        {lines.filter(line => line.projectId === share.projectId).map(line => <div key={line.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
          <label className="min-w-0 space-y-1 text-sm">{line.kind === "PRODUCT" ? "Изделие" : "Материал"}
            <SearchableSelect value={line.entityId} disabled={busy} placeholder="Выберите позицию…"
              options={line.kind === "PRODUCT" ? products.filter(product => product.projectId === line.projectId)
                .map(product => ({ value: product.id, label: label(product.number, product.title) }))
                : data.materials.map(material => ({ value: material.id, label: label(material.sku, material.name) }))}
              onChange={entityId => updateLine(line.key, { entityId })} />
          </label>
          <label className="space-y-1 text-sm">Количество <Input value={line.quantity} inputMode="decimal" disabled={busy}
            onChange={event => updateLine(line.key, { quantity: event.target.value })} /></label>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => {
            edited();
            setLines(previous => previous.filter(row => row.key !== line.key));
          }}>Убрать позицию</Button>
        </div>)}
        <div className="flex flex-wrap gap-2">
          {(["PRODUCT", "MATERIAL"] as const).map(kind => <Button key={kind} variant="outline" size="sm" disabled={busy} onClick={() => {
            edited();
            const key = crypto.randomUUID();
            setLines(previous => [...previous, { key, projectId: share.projectId, kind, entityId: "", quantity: "1" }]);
          }}>{kind === "PRODUCT" ? "Добавить изделие" : "Добавить материал"}</Button>)}
        </div>
      </section>)}
      <p className="text-sm">Сумма долей {percentLabel(shares.reduce((sum, share) => sum + percentBps(share.percent), 0))}</p>
      {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
      {preview && <div className="space-y-2 rounded-xl border p-3 text-sm" aria-live="polite">
        {preview.output.noOp ? <p>Состав и доли совпадают с действующим распределением.</p> : <>
          <h3 className="font-medium">Новое распределение</h3>
          <ul className="space-y-1">
            {preview.output.allocations.map(part => <li key={part.projectId}>
              {projectLabel(part.projectId)} · {part.amount} {data.currency} · {part.bynAmount} BYN
              {part.roundingAdjustment !== "0.00" && ` (поправка ${Number(part.roundingAdjustment) > 0 ? "+" : ""}${part.roundingAdjustment} BYN)`}
            </li>)}
          </ul>
          <p>Итого {preview.output.amount} {data.currency} · {preview.output.bynAmount} BYN.</p>
          {preview.output.difference !== "0.00" && <p>Разница построчного округления {preview.output.difference} BYN распределена по долям.</p>}
        </>}
      </div>}
    </div>
    <DialogFooter>
      <Button variant="outline" disabled={busy} onClick={close}>Закрыть</Button>
      {preview ? <Button disabled={busy || preview.output.noOp} onClick={() => void save()}>Подтвердить перераспределение</Button>
        : <Button disabled={busy} onClick={() => void calculate()}>Проверить распределение</Button>}
    </DialogFooter>
  </>;
}

export function LogisticsReallocationButton({ paymentId, closeExpense }: { paymentId: string; closeExpense: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Details | null>(null);
  const [message, setMessage] = useState("");
  async function show() {
    setOpen(true);
    setMessage("");
    setData(null);
    try {
      const result = await readTripReallocation(paymentId);
      if (result.ok) setData(result);
      else setMessage(result.message);
    } catch { setMessage("Не удалось открыть распределение"); }
  }
  return <>
    <Button variant="outline" onClick={() => void show()}>Распределение рейса</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Распределение рейса</DialogTitle>
          <DialogDescription>Проверьте проекты, доли и состав отгрузки. Оплата и ТТН сохранятся.</DialogDescription>
        </DialogHeader>
        {data ? <ReallocationForm data={data} close={() => setOpen(false)} saved={() => {
          setOpen(false);
          closeExpense();
          router.refresh();
          toast.success("Распределение рейса обновлено");
        }} /> : <p className="text-sm" role="status">{message || "Загрузка рейса…"}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
