"use client";

import { useState, useSyncExternalStore } from "react";
import { Trash2 } from "lucide-react";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { InlineTextField, SaveState } from "@/components/inline-fields";
import { useProductInline } from "@/components/product-inline-provider";
import { SectionAdder, SectionList, TechnicalText, sources, technicalValueClass } from "@/components/product-technical-editor-fields";
import { Button } from "@/components/ui/button";
import { useInlineSave } from "@/hooks/use-inline-save";
import type { InlineSaveController } from "@/lib/inline-save-controller";

function PersistedText({ label, controller, disabled }: {
  label: string;
  controller: InlineSaveController;
  disabled?: boolean;
}) {
  const field = useInlineSave(controller);
  return <div className="grid min-w-0 gap-1">
    <TechnicalText label={label} value={String(field.draft)} onChange={field.setDraft}
      onCommit={() => { if (!disabled) void field.commit(); }} issue={Boolean(field.error)} disabled={disabled} />
    {field.status === "conflict" && field.currentValue === undefined
      ? <p className="break-words text-xs text-destructive" role="alert">{field.error} Скопируйте введённый текст перед обновлением карточки.</p>
      : field.status !== "idle" && <SaveState field={field} />}
  </div>;
}

export function ProductTechnicalSpecifications({ canEdit, canEditLegacy }: { canEdit: boolean; canEditLegacy: boolean }) {
  const { controller, technical } = useProductInline();
  const state = useSyncExternalStore(technical.subscribe, technical.getSnapshot, technical.getServerSnapshot);
  const legacy = controller("description");
  const original = useSyncExternalStore(legacy.subscribe, () => legacy.getSnapshot().baseline, () => legacy.getServerSnapshot().baseline);
  const [removing, setRemoving] = useState<Awaited<ReturnType<typeof technical.prepareRemove>>>(null);
  const [addFormVersion, setAddFormVersion] = useState(0);
  const disabled = state.pending || Boolean(state.issue);
  const issue = canEdit && state.issue && (
    <div className="grid gap-1">
      <p role="alert" className="text-sm text-destructive">{state.issue.error}</p>
      {state.issue.retryable ? (
        <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={async () => {
          if (await technical.retry()) {
            setRemoving(null);
            if (!removing) setAddFormVersion(version => version + 1);
          }
        }}>Повторить сохранение раздела</Button>
      ) : (
        <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={technical.dismissIssue}>Закрыть сообщение</Button>
      )}
    </div>
  );

  return <section className="grid min-w-0 gap-3" aria-label="Техническое описание" data-product-technical-specifications>
    {state.structured ? <>
      <h2 className="text-sm font-semibold">Техническое описание</h2>
      <SectionList sections={state.sections} editable={canEdit} render={section => canEdit ? (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          <PersistedText label={section.label} controller={technical.section(section.id)}
            disabled={state.lockedSectionId === section.id || (removing?.section.id === section.id && state.pending)} />
          <Button type="button" variant="ghost" size="icon" className="mt-5" disabled={disabled}
            aria-label={`Удалить раздел «${section.label}»`} onClick={async () => {
              const confirmed = await technical.prepareRemove(section.id);
              if (confirmed) setRemoving(confirmed);
            }}>
            <Trash2 />
          </Button>
        </div>
      ) : <TechnicalText label={section.label} value={section.value} />} />
      {canEdit ? (
        <div className="grid min-w-0 gap-3 border-t pt-3">
          {sources.map(([source, label]) => <PersistedText key={source} label={label} controller={technical.source(source)} />)}
        </div>
      ) : <ReadOnlySources />}
      {original !== null && <details className="min-w-0 rounded-lg border bg-muted/30 p-3 text-sm">
        <summary className="cursor-pointer font-medium">Исходное описание</summary>
        <div className={`mt-2 ${technicalValueClass}`}>{original}</div>
      </details>}
    </> : (
      <InlineTextField id="product-inline-description" label="Техническое описание" controller={legacy}
        readOnly={!canEditLegacy || state.pending || state.lockedLegacy} multiline largeDescription />
    )}
    {canEdit && <div className="min-w-0">
      <SectionAdder key={addFormVersion} sections={state.sections} disabled={disabled} onAdd={technical.add} />
    </div>}
    {removing ? <ConfirmDeleteDialog entityLabel={`раздел «${removing.section.label}»`} open
      onOpenChange={open => { if (!open) setRemoving(null); }}
      confirmDisabled={disabled} onConfirm={() => technical.remove(removing)}>
      {removing.section.value && <p className={`max-h-40 overflow-y-auto text-sm ${technicalValueClass}`}>{removing.section.value}</p>}
      {issue}
    </ConfirmDeleteDialog> : issue}
    {canEdit && state.pending && !removing && <p aria-live="polite" className="text-xs text-muted-foreground">Сохраняется раздел…</p>}
  </section>;
}

function ReadOnlySources() {
  const { technical } = useProductInline();
  const description = String(useInlineSave(technical.source("description")).baseline ?? "");
  const size = String(useInlineSave(technical.source("size")).baseline ?? "");
  const note = String(useInlineSave(technical.source("note")).baseline ?? "");
  const values = { description, size, note };
  if (!sources.some(([source]) => values[source].trim())) return null;
  return <div className="grid min-w-0 gap-3 border-t pt-3">
    {sources.map(([source, label]) => values[source].trim() && <TechnicalText key={source} label={label} value={values[source]} />)}
  </div>;
}
