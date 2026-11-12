"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import FurnitureSpecifications from "@pero/kp-template/furniture-specifications";
import { useProductInline } from "@/components/product-inline-provider";
import { TechnicalList, TechnicalText } from "@/components/product-technical-editor-fields";
import { useInlineSave } from "@/hooks/use-inline-save";
import type { InlineSaveController } from "@/lib/inline-save-controller";

function TechnicalEntry({ label, controller, canEdit }: {
  label: string; controller: InlineSaveController<string>; canEdit: boolean;
}) {
  const field = useInlineSave(controller);
  useEffect(() => { if (field.error) toast.error(field.error); }, [field.error]);
  return <TechnicalText label={label} value={field.draft} onChange={canEdit ? field.setDraft : undefined}
    onCommit={() => { if (canEdit) void (field.error ? field.retry() : field.commit()); }} autosave issue={field.error} />;
}

export function ProductTechnicalSpecifications({ canEdit }: { canEdit: boolean; canEditLegacy?: boolean }) {
  const { technical } = useProductInline();
  return <TechnicalList>{FurnitureSpecifications.CATALOG.map(item => <TechnicalEntry key={item.type}
    label={item.label} controller={technical.section(item.type)} canEdit={canEdit} />)}</TechnicalList>;
}
