"use client";

import { useId, useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import FurnitureSpecifications from "@pero/kp-template/furniture-specifications";
import type { FurnitureSection, FurnitureSectionGroup, TechnicalSpecifications } from "@pero/kp-template";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";

const technicalSourceLabels = { description: "Описание", size: "Размеры", note: "Примечание" } as const;
export const sources = Object.entries(technicalSourceLabels) as [keyof typeof technicalSourceLabels, string][];
export const technicalValueClass = "whitespace-pre-wrap break-words [overflow-wrap:anywhere]";

export function SectionAdder({ sections, disabled, onAdd }: {
  sections: FurnitureSection[];
  disabled?: boolean;
  onAdd: (section: FurnitureSection) => Promise<boolean>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("");
  const [label, setLabel] = useState("");
  const [group, setGroup] = useState<FurnitureSectionGroup>("construction");
  const available = FurnitureSpecifications.CATALOG.filter(item => !sections.some(row => row.type === item.type));
  const standard = available.find(item => item.type === type);
  const custom = type === "custom";
  const ready = Boolean(standard || (custom && label.trim()));

  function close() {
    setOpen(false);
    setType("");
    setLabel("");
    setGroup("construction");
  }

  if (!open) return (
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
      <Plus /> Добавить раздел
    </Button>
  );
  return (
    <div className="grid min-w-0 gap-2 rounded-lg border bg-muted/30 p-3">
      <Label htmlFor={`${id}-type`}>Тип раздела</Label>
      <SearchableSelect
        id={`${id}-type`} value={type} onChange={setType} disabled={disabled}
        options={[...available.map(item => ({ value: item.type, label: item.label })), { value: "custom", label: "Свой раздел" }]}
      />
      {custom && <>
        <Label htmlFor={`${id}-label`}>Название раздела</Label>
        <Input id={`${id}-label`} value={label} onChange={event => setLabel(event.target.value)} disabled={disabled} />
        <Label htmlFor={`${id}-group`}>Группа раздела</Label>
        <SearchableSelect
          id={`${id}-group`} value={group} disabled={disabled}
          options={FurnitureSpecifications.GROUPS.map(item => ({ value: item.id, label: item.label }))}
          onChange={next => {
            const selected = FurnitureSpecifications.GROUPS.find(item => item.id === next);
            if (selected) setGroup(selected.id);
          }}
        />
      </>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={!ready || disabled} onClick={async () => {
          const section: FurnitureSection | null = standard
            ? { ...standard, id: crypto.randomUUID(), value: "" }
            : custom && label.trim() ? { type: "custom", id: crypto.randomUUID(), group, label: label.trim(), value: "" } : null;
          if (section && await onAdd(section)) close();
        }}>Добавить</Button>
        <Button type="button" size="sm" variant="ghost" onClick={close}>Отмена</Button>
      </div>
    </div>
  );
}

export function SectionList({ sections, render, editable }: {
  sections: FurnitureSection[];
  render: (section: FurnitureSection) => ReactNode;
  editable?: boolean;
}) {
  const ordered = FurnitureSpecifications.orderedSections(sections);
  if (editable) {
    let number = 0;
    return ordered.length > 0 && <div className="grid gap-2">
      {ordered.map(section => (
        <div key={section.id} className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-1" data-technical-section={section.id}>
          <span className="pt-0.5 text-right text-xs font-medium tabular-nums text-muted-foreground" aria-hidden>
            {section.value.trim() ? `${++number}.` : null}
          </span>
          {render(section)}
        </div>
      ))}
    </div>;
  }
  const filled = ordered.filter(section => section.value.trim());
  return filled.length > 0 && <ol className="list-decimal space-y-2 ps-6 marker:font-medium marker:text-muted-foreground">
      {filled.map(section => <li key={section.id} className="min-w-0 ps-1">{render(section)}</li>)}
  </ol>;
}

export function TechnicalText({ inputId, label, value, onChange, onCommit, issue, disabled }: {
  inputId?: string;
  label: string;
  value: string;
  onChange?: (value: string) => void;
  onCommit?: () => void;
  issue?: boolean;
  disabled?: boolean;
}) {
  const automaticId = useId();
  const id = inputId ?? automaticId;
  if (!onChange) return (
    <div className="min-w-0 text-sm">
      <div className={`font-medium ${technicalValueClass}`}>{label}</div>
      <div className={technicalValueClass}>{value}</div>
    </div>
  );
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id} className={`block ${technicalValueClass}`}>{label}</Label>
      <Textarea
        id={id} rows={1} value={value} readOnly={disabled} aria-invalid={issue}
        className="min-h-9 min-w-0 resize-y py-1.5 [overflow-wrap:anywhere]"
        onChange={event => onChange(event.target.value)} onBlur={onCommit}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
          event.preventDefault();
          onCommit?.();
        }}
      />
    </div>
  );
}

export function NewProductTechnicalSpecifications({ value, onChange, disabled }: {
  value: TechnicalSpecifications;
  onChange: (value: TechnicalSpecifications) => void;
  disabled?: boolean;
}) {
  const [removing, setRemoving] = useState<FurnitureSection | null>(null);
  return <section className="grid min-w-0 gap-3 rounded-lg border p-3" aria-label="Техническое описание">
    <h3 className="text-sm font-semibold">Техническое описание</h3>
    <SectionList sections={value.sections} editable render={section => (
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <TechnicalText label={section.label} value={section.value} disabled={disabled}
          onChange={draft => onChange({ ...value, sections: value.sections.map(row => row.id === section.id ? { ...row, value: draft } : row) })} />
        <Button type="button" variant="ghost" size="icon" className="mt-5" disabled={disabled}
          aria-label={`Удалить раздел «${section.label}»`} onClick={() => setRemoving(section)}>
          <Trash2 />
        </Button>
      </div>
    )} />
    <div className="min-w-0">
      <SectionAdder sections={value.sections} disabled={disabled} onAdd={async section => {
        onChange({ ...value, sections: [...value.sections, section] });
        return true;
      }} />
    </div>
    <div className="grid min-w-0 gap-3 border-t pt-3">
      {sources.map(([source, label]) => <TechnicalText key={source} inputId={`product-${source}`} label={label} value={value[source] ?? ""}
        disabled={disabled} onChange={draft => onChange({ ...value, [source]: draft || null })} />)}
    </div>
    {removing && <ConfirmDeleteDialog entityLabel={`раздел «${removing.label}»`} open
      onOpenChange={open => { if (!open) setRemoving(null); }}
      onConfirm={async () => {
        onChange({ ...value, sections: value.sections.filter(row => row.id !== removing.id) });
      }}
    />}
  </section>;
}
