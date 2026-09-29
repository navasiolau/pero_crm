"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { normalizeFinishAssignment, type FinishKind, type FinishAssignment, type SurfaceKind } from "@/lib/surface-finishes";
import type { CompositionFinish } from "./composition-finish-display";

export type CompositionFinishFormValues = {
  itemId: string;
  finishId?: string;
  surfaceKind: string;
  surfaceLabel: string;
  layerOrder: string;
  finishKind: string;
  name: string;
  code: string;
  colorHex: string;
  sampleFileId: string;
};

export type FinishSampleFile = { id: string; fileName: string; mimeType: string };

export type CompositionFinishSaveValues = {
  itemId: string;
  finishId?: string;
  surfaceKind: SurfaceKind;
  surfaceLabel: string;
  layerOrder: number;
  finishKind: FinishKind;
  name: string;
  code: string;
  colorHex: string | null;
  sampleFileId: string | null;
};

export type CompositionFinishFormValidation =
  | { ok: true; value: CompositionFinishSaveValues }
  | { ok: false; message: string };

export function validateCompositionFinishForm(
  values: CompositionFinishFormValues,
  existing: CompositionFinish[],
  sampleFiles: FinishSampleFile[],
): CompositionFinishFormValidation {
  const surfaceKinds = new Set<SurfaceKind>(["FACE", "EDGE", "WHOLE"]);
  const finishKinds = new Set<FinishKind>(["ENAMEL", "VENEER", "COATING"]);
  if (!values.itemId.trim()) return { ok: false, message: "Выберите позицию состава для покрытия." };
  if (!surfaceKinds.has(values.surfaceKind as SurfaceKind)) return { ok: false, message: "Выберите тип поверхности." };
  if (values.surfaceKind !== "WHOLE" && !values.surfaceLabel.trim()) {
    return { ok: false, message: "Укажите подпись поверхности." };
  }
  const layerOrder = values.layerOrder.trim();
  if (!/^\d+$/.test(layerOrder) || Number(layerOrder) < 1 || Number(layerOrder) > 20) {
    return { ok: false, message: "Номер слоя должен быть целым числом от 1 до 20." };
  }
  if (!finishKinds.has(values.finishKind as FinishKind)) return { ok: false, message: "Выберите тип покрытия." };
  if (!values.name.trim()) return { ok: false, message: "Укажите название материала." };
  if (!values.code.trim()) return { ok: false, message: "Укажите код материала." };
  if (Array.from(values.surfaceLabel.trim()).length > 80) return { ok: false, message: "Подпись поверхности не должна превышать 80 символов." };
  if (Array.from(values.name.trim()).length > 160) return { ok: false, message: "Название не должно превышать 160 символов." };
  if (Array.from(values.code.trim()).length > 160) return { ok: false, message: "Код не должен превышать 160 символов." };
  if (values.colorHex.trim() && !/^#[\da-fA-F]{6}$/.test(values.colorHex.trim())) {
    return { ok: false, message: "Цвет задаётся в формате #RRGGBB." };
  }
  const sampleFileId = values.sampleFileId.trim() || null;
  if (sampleFileId && !sampleFiles.some((file) => file.id === sampleFileId)) {
    return { ok: false, message: "Выберите образец из файлов этого изделия." };
  }

  let normalized: FinishAssignment;
  try {
    normalized = normalizeFinishAssignment({
      itemId: values.itemId,
      surfaceKind: values.surfaceKind,
      surfaceLabel: values.surfaceKind === "WHOLE" ? "Целиком" : values.surfaceLabel,
      layerOrder: Number(layerOrder),
      finishKind: values.finishKind,
      name: values.name,
      code: values.code,
      colorHex: values.colorHex.trim() || null,
      sampleFileId,
    });
  } catch {
    return { ok: false, message: "Проверьте подпись и обозначения покрытия: пустые значения и управляющие символы недопустимы." };
  }

  const duplicate = existing.some((finish) => finish.id !== values.finishId &&
    finish.itemId === normalized.itemId && finish.surfaceKind === normalized.surfaceKind &&
    finish.normalizedSurfaceLabel === normalized.normalizedSurfaceLabel && finish.layerOrder === normalized.layerOrder);
  if (duplicate) return { ok: false, message: "На этой поверхности уже есть слой с таким номером." };

  return {
    ok: true,
    value: {
      itemId: normalized.itemId,
      ...(values.finishId ? { finishId: values.finishId } : {}),
      surfaceKind: normalized.surfaceKind,
      surfaceLabel: normalized.surfaceLabel,
      layerOrder: normalized.layerOrder,
      finishKind: normalized.finishKind,
      name: normalized.name,
      code: normalized.code,
      colorHex: normalized.colorHex,
      sampleFileId: normalized.sampleFileId,
    },
  };
}

export function CompositionFinishForm({
  initial,
  existing,
  sampleFiles,
  pending = false,
  error,
  onSubmit,
  onCancel,
}: {
  initial: CompositionFinishFormValues;
  existing: CompositionFinish[];
  sampleFiles: FinishSampleFile[];
  pending?: boolean;
  error?: string | null;
  onSubmit: (value: CompositionFinishSaveValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [validationError, setValidationError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateCompositionFinishForm(values, existing, sampleFiles);
    if (!result.ok) {
      setValidationError(result.message);
      return;
    }
    setValidationError(null);
    onSubmit(result.value);
  }

  return (
    <form className="min-w-0 space-y-4" onSubmit={submit}>
      <div className="space-y-1.5">
        <Label htmlFor="finish-surface-kind">Тип поверхности *</Label>
        <select id="finish-surface-kind" className="border-input bg-background min-h-12 w-full min-w-0 rounded-md border px-3 text-base"
          value={values.surfaceKind} disabled={pending}
          onChange={(event) => setValues((current) => ({ ...current, surfaceKind: event.target.value,
            surfaceLabel: event.target.value === "WHOLE" ? "Целиком" : current.surfaceKind === "WHOLE" ? "" : current.surfaceLabel }))}>
          <option value="FACE">Сторона</option><option value="EDGE">Кромка</option><option value="WHOLE">Целиком</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="finish-surface-label">Подпись поверхности *</Label>
        <Input id="finish-surface-label" className="min-h-12 text-base" value={values.surfaceKind === "WHOLE" ? "Целиком" : values.surfaceLabel}
          disabled={pending || values.surfaceKind === "WHOLE"} maxLength={80}
          placeholder={values.surfaceKind === "EDGE" ? "Например, левая кромка" : "Например, лицевая сторона"}
          onChange={(event) => setValues((current) => ({ ...current, surfaceLabel: event.target.value }))} />
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="finish-layer-order">Слой *</Label>
          <Input id="finish-layer-order" type="number" inputMode="numeric" min={1} max={20} step={1}
            className="min-h-12 text-base" value={values.layerOrder} disabled={pending}
            onChange={(event) => setValues((current) => ({ ...current, layerOrder: event.target.value }))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="finish-kind">Тип покрытия *</Label>
          <select id="finish-kind" className="border-input bg-background min-h-12 w-full min-w-0 rounded-md border px-3 text-base"
            value={values.finishKind} disabled={pending}
            onChange={(event) => setValues((current) => ({ ...current, finishKind: event.target.value }))}>
            <option value="ENAMEL">Эмаль</option><option value="VENEER">Шпон</option><option value="COATING">Покрытие</option>
          </select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="finish-name">Название *</Label>
        <Input id="finish-name" className="min-h-12 text-base" maxLength={160} value={values.name} disabled={pending}
          onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="finish-code">Код *</Label>
        <Input id="finish-code" className="min-h-12 text-base" maxLength={160} value={values.code} disabled={pending}
          onChange={(event) => setValues((current) => ({ ...current, code: event.target.value }))} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="finish-color-hex">Цветовой образец HEX</Label>
        <div className="flex min-w-0 items-center gap-2">
          <Input id="finish-color-hex" className="min-h-12 min-w-0 text-base" maxLength={7} value={values.colorHex} disabled={pending}
            placeholder="#F1F0EA" onChange={(event) => setValues((current) => ({ ...current, colorHex: event.target.value }))} />
          {/^#[\da-fA-F]{6}$/.test(values.colorHex.trim()) ? <span className="finish-color-swatch size-8 shrink-0 rounded border" aria-label={`Образец цвета ${values.colorHex.trim().toUpperCase()}`}
            style={{ backgroundColor: values.colorHex.trim().toUpperCase() }} /> : null}
        </div>
      </div>
      <div className="space-y-1.5" role="group" aria-labelledby="finish-sample-label">
        <Label id="finish-sample-label">Образец изображения</Label>
        <SearchableSelect
          options={sampleFiles.map((file) => ({ value: file.id, label: file.fileName, hint: file.mimeType }))}
          value={values.sampleFileId} onChange={(sampleFileId) => setValues((current) => ({ ...current, sampleFileId }))}
          placeholder="Образец не задан" searchPlaceholder="Поиск по файлам изделия…"
          disabled={pending} allowClear className="min-h-12 h-auto w-full whitespace-normal text-left" />
        <p className="text-xs text-muted-foreground">Показываются только доступные растровые файлы этого изделия.</p>
      </div>
      {validationError || error ? <p role="alert" className="break-words text-sm text-destructive">{validationError ?? error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-12 h-auto whitespace-normal" disabled={pending} onClick={onCancel}>Отмена</Button>
        <Button type="submit" className="min-h-12 h-auto whitespace-normal" disabled={pending}>{pending ? "Сохранение…" : "Сохранить покрытие"}</Button>
      </div>
    </form>
  );
}
