import Image from "next/image";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FinishAssignment } from "@/lib/surface-finishes";

export type CompositionFinish = FinishAssignment & { id: string };

const surfaceLabels = { FACE: "Сторона", EDGE: "Кромка", WHOLE: "Целиком" } as const;
const finishLabels = { ENAMEL: "Эмаль", VENEER: "Шпон", COATING: "Покрытие" } as const;

export function CompositionFinishDisplay({
  finishes,
  canEdit = false,
  onAdd,
  onEdit,
  onDelete,
}: {
  finishes: CompositionFinish[];
  canEdit?: boolean;
  onAdd?: () => void;
  onEdit?: (finish: CompositionFinish) => void;
  onDelete?: (finish: CompositionFinish) => void;
}) {
  const surfaces = new Map<string, { kind: CompositionFinish["surfaceKind"]; label: string; finishes: CompositionFinish[] }>();
  for (const finish of finishes) {
    const key = JSON.stringify([finish.surfaceKind, finish.normalizedSurfaceLabel]);
    const surface = surfaces.get(key) ?? { kind: finish.surfaceKind, label: finish.surfaceLabel, finishes: [] };
    surface.finishes.push(finish);
    surfaces.set(key, surface);
  }

  return (
    <section className="min-w-0 space-y-2 border-t pt-3" aria-label="Покрытия позиции состава">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Покрытия</h4>
        {canEdit && onAdd ? (
          <Button type="button" variant="outline" className="min-h-11 h-auto whitespace-normal" onClick={onAdd}>
            <Plus className="size-4" /> Добавить покрытие
          </Button>
        ) : null}
      </div>
      {surfaces.size === 0 ? <p className="text-sm text-muted-foreground">Покрытия не заданы.</p> : (
        <div className="min-w-0 space-y-3">
          {[...surfaces.entries()].map(([key, surface]) => (
            <section key={key} className="min-w-0 space-y-2 rounded-md bg-muted/30 p-3" aria-label={`${surfaceLabels[surface.kind]} ${surface.label}`}>
              <h5 className="break-words [overflow-wrap:anywhere] text-sm font-medium">
                {surface.kind === "WHOLE" ? "Целиком" : `${surfaceLabels[surface.kind]}: ${surface.label}`}
              </h5>
              <ol className="min-w-0 space-y-2" aria-label={`Слои покрытия ${surface.label}`}>
                {surface.finishes.map((finish) => (
                  <li key={finish.id} className="flex min-w-0 flex-col gap-2 rounded-md border bg-background p-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge variant="outline">Слой {finish.layerOrder} · {finishLabels[finish.finishKind]}</Badge>
                        {finish.colorHex ? <span className="inline-flex min-h-8 items-center gap-1.5 rounded border px-2 text-xs">
                          <span className="finish-color-swatch size-5 shrink-0 rounded-sm border" aria-label={`Образец цвета ${finish.colorHex}`}
                            style={{ backgroundColor: finish.colorHex }} />
                          {finish.colorHex}
                        </span> : null}
                      </div>
                      <p className="break-words [overflow-wrap:anywhere] font-medium">{finish.name}</p>
                      <p className="break-words [overflow-wrap:anywhere] text-sm text-muted-foreground">Код: <span className="font-mono text-foreground">{finish.code}</span></p>
                      {finish.sampleFileId ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-2 pt-1">
                          <Image
                            src={`/api/files/${finish.sampleFileId}?thumb=1`}
                            alt={`${finish.finishKind === "VENEER" ? "Образец текстуры" : "Изображение-образец"}: ${finish.name} (${finish.code})`}
                            width={96}
                            height={64}
                            unoptimized
                            className="h-16 w-24 rounded border object-cover"
                          />
                          <span className="break-words text-xs text-muted-foreground">
                            {finish.finishKind === "VENEER" ? "Образец текстуры" : "Изображение-образец"}
                          </span>
                          <a className="min-h-11 inline-flex items-center break-words text-sm underline underline-offset-2" href={`/api/files/${finish.sampleFileId}`} target="_blank" rel="noopener noreferrer">
                            Открыть образец
                          </a>
                        </div>
                      ) : !finish.colorHex ? <p className="text-xs text-muted-foreground">Образец не задан</p> : null}
                    </div>
                    {canEdit ? <div className="flex shrink-0 flex-wrap gap-2">
                      {onEdit ? <Button type="button" variant="outline" size="icon" className="min-h-11 min-w-11" aria-label={`Изменить покрытие ${finish.name} ${finish.code}`} onClick={() => onEdit(finish)}>
                        <Pencil className="size-4" />
                      </Button> : null}
                      {onDelete ? <Button type="button" variant="outline" size="icon" className="min-h-11 min-w-11" aria-label={`Удалить покрытие ${finish.name} ${finish.code}`} onClick={() => onDelete(finish)}>
                        <Trash2 className="size-4" />
                      </Button> : null}
                    </div> : null}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
