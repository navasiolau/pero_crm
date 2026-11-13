"use client";

import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useProductInline } from "@/components/product-inline-provider";
import { TechnicalList, TechnicalText } from "@/components/product-technical-editor-fields";
import { useInlineSave } from "@/hooks/use-inline-save";
import { technicalRowDraft } from "@/lib/product-technical-editor";

function TechnicalEntry({ rowId, number, canEdit, trailing }: { rowId: string; number: number; canEdit: boolean; trailing: boolean }) {
  const { technical } = useProductInline();
  const field = useInlineSave(technical.section(rowId));
  const row = technicalRowDraft(field.draft);
  useEffect(() => { if (field.error) toast.error(field.error); }, [field.error]);
  if (!canEdit && (trailing || (row.label === "" && row.value === ""))) return null;
  return <TechnicalText rowId={rowId} number={number} row={row} trailing={trailing}
    onActive={active => technical.setActive(rowId, active)}
    onChange={canEdit ? pair => technical.setRow(rowId, pair) : undefined}
    onCommit={() => { if (canEdit) void (field.error ? field.retry() : field.commit()); }} autosave issue={field.error} />;
}

export function ProductTechnicalSpecifications({ canEdit }: { canEdit: boolean; canEditLegacy?: boolean }) {
  const { technical } = useProductInline();
  const state = useSyncExternalStore(technical.subscribe, technical.getSnapshot, technical.getServerSnapshot);
  const rows = canEdit ? state.rows : state.rows.filter(key => { const row = technicalRowDraft(technical.section(key).getSnapshot().draft); return key !== state.trailing && (row.label !== "" || row.value !== ""); });
  return <TechnicalList>{rows.map((rowId, index) => <TechnicalEntry key={rowId} rowId={rowId}
    number={index + 1} canEdit={canEdit} trailing={rowId === state.trailing} />)}</TechnicalList>;
}
