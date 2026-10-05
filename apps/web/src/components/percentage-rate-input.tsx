"use client";
import {ChevronUp,ChevronDown} from 'lucide-react';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {acceptsPercentageDraft,stepPercentageDraft} from '@/lib/percentage-rate-input';

export function PercentageRateInput({id,label,draft,readOnly,error,setDraft,commit}:{id:string;label:string;draft:string;readOnly:boolean;error:boolean;setDraft:(value:string)=>void;commit:()=>Promise<boolean>}){
 const step=(direction:1|-1)=>{if(readOnly)return;const next=stepPercentageDraft(draft,direction);if(next===null)return;setDraft(next);void commit();};
 return <div className="flex min-w-0 flex-col gap-1.5"><Label htmlFor={id}>{label}</Label><div className="relative min-w-0"><Input id={id} type="text" inputMode="decimal" value={draft} readOnly={readOnly} aria-invalid={error} aria-describedby={`${id}-state`} className="min-w-0 pr-8 text-foreground" onChange={event=>{if(acceptsPercentageDraft(event.target.value))setDraft(event.target.value);}} onBlur={()=>{if(!readOnly)void commit();}} onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();step(event.key==='ArrowUp'?1:-1);}else if(event.key==='Enter'){event.preventDefault();if(!readOnly)void commit();}}}/>{!readOnly?<div className="absolute inset-y-1 right-1 flex w-6 flex-col"><button type="button" aria-label={`${label}: увеличить на 0.5`} className="flex min-h-0! min-w-0! flex-1 items-center justify-center rounded-sm hover:bg-accent" onMouseDown={event=>event.preventDefault()} onClick={()=>step(1)}><ChevronUp className="size-3"/></button><button type="button" aria-label={`${label}: уменьшить на 0.5`} className="flex min-h-0! min-w-0! flex-1 items-center justify-center rounded-sm hover:bg-accent" onMouseDown={event=>event.preventDefault()} onClick={()=>step(-1)}><ChevronDown className="size-3"/></button></div>:null}</div></div>;

}
