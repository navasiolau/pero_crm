"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAmount } from "@/lib/format";
import { productLineTotal } from "@/lib/product-quantity";
import {ChevronUp,ChevronDown} from 'lucide-react';
import {acceptsQuantityDraft,stepQuantityDraft} from '@/lib/product-quantity-input';
import {useInlineSave} from '@/hooks/use-inline-save';
import {SaveState} from '@/components/inline-fields';
import type {InlineSaveController,InlineValue} from '@/lib/inline-save-controller';

export function QuantitySpinner({id,value,onChange,onCommit,readOnly=false,error=false}:{id:string;value:string;onChange:(value:string)=>void;onCommit?:()=>Promise<boolean>;readOnly?:boolean;error?:boolean}){
 const step=(direction:1|-1)=>{if(readOnly)return;const next=stepQuantityDraft(value,direction);if(next===null)return;onChange(next);void onCommit?.();};
 return <div className="relative min-w-0"><Input id={id} type="text" inputMode="numeric" value={value} readOnly={readOnly} aria-invalid={error} aria-describedby={`${id}-state`} className="min-w-0 pr-8" onChange={event=>{if(acceptsQuantityDraft(event.target.value))onChange(event.target.value);}} onBlur={()=>{if(!readOnly)void onCommit?.();}} onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();step(event.key==='ArrowUp'?1:-1);}else if(event.key==='Enter'){event.preventDefault();if(!readOnly)void onCommit?.();}}}/>{!readOnly?<div className="absolute inset-y-1 right-1 flex w-6 flex-col">{([1,-1] as const).map(direction=><button key={direction} type="button" aria-label={direction===1?'Увеличить количество на 1':'Уменьшить количество на 1'} className="flex flex-1 items-center justify-center rounded-sm hover:bg-accent" onMouseDown={event=>event.preventDefault()} onClick={()=>step(direction)}>{direction===1?<ChevronUp className="size-3"/>:<ChevronDown className="size-3"/>}</button>)}</div>:null}</div>;
}
export function InlineQuantityField({controller,readOnly}:{controller:InlineSaveController<InlineValue>;readOnly:boolean}){
 const field=useInlineSave(controller),id='product-inline-quantity';
 return <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor={id}>Количество</Label><QuantitySpinner id={id} value={field.draft} onChange={field.setDraft} onCommit={field.commit} readOnly={readOnly} error={Boolean(field.error)}/>{!readOnly||field.error||field.status==='dirty'?<div id={`${id}-state`}><SaveState field={field} readOnly={readOnly}/></div>:null}</div>;
}

export function ProductQuantityInput({ value, onChange, price, currency, showAmount }: {
  value: string; onChange: (value: string) => void; price: string | null; currency: string; showAmount: boolean;
}) {
  let total: string | null = null;
  try { total = productLineTotal(price, Number(value)); } catch { /* Некорректный ввод исправляется до сохранения. */ }
  return <div className="flex flex-col gap-1.5">
    <Label htmlFor="product-quantity">Количество, шт.</Label>
    <QuantitySpinner id="product-quantity" value={value} onChange={onChange}/>
    {showAmount && <p className="text-sm text-muted-foreground">Сумма партии: {formatAmount(total, currency)}</p>}
  </div>;
}
