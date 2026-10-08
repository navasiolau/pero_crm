"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { formatQty } from "@/lib/format";
import type { StockMaterialOption } from "@/server/warehouse/contracts";
export function StockMaterialFields({ materials, materialId, onMaterialChange, quantity, onQuantityChange, unitPrice, onPriceChange, currency, prefix, disabled }: {
  materials: StockMaterialOption[]; materialId: string; onMaterialChange: (value: string) => void;
  quantity: string; onQuantityChange: (value: string) => void; unitPrice: string; onPriceChange: (value: string) => void;
  currency: string; prefix: string; disabled?: boolean;
}) {
  return <>
    <StockMaterialPicker materials={materials} value={materialId} onChange={onMaterialChange} id={`${prefix}-material`} disabled={disabled} />
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor={`${prefix}-qty`}>Количество *</Label>
        <Input id={`${prefix}-qty`} disabled={disabled} inputMode="decimal" value={quantity} onChange={event => onQuantityChange(event.target.value)} placeholder="0" /></div>
      <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor={`${prefix}-price`}>Цена за единицу, {currency} *</Label>
        <Input id={`${prefix}-price`} disabled={disabled} inputMode="decimal" value={unitPrice} onChange={event => onPriceChange(event.target.value)} placeholder="Больше нуля" required /></div>
    </div>
  </>;
}

export function StockMaterialPicker({materials,value,onChange,id,disabled}:{materials:StockMaterialOption[];value:string;onChange:(value:string)=>void;id:string;disabled?:boolean}) {
  return <div className="flex min-w-0 flex-col gap-1.5">
    <Label htmlFor={id}>Материал *</Label>
    <SearchableSelect id={id} disabled={disabled} value={value} onChange={onChange}
      placeholder="Выберите материал…" searchPlaceholder="Поиск материала…" emptyText="Материал не найден"
      options={materials.map(material=>({value:material.id,label:material.name,
        hint:[material.sku,material.stock===undefined?material.unit:`остаток ${formatQty(material.stock)} ${material.unit}`].filter(Boolean).join(" · ")}))}/>
  </div>;
}
