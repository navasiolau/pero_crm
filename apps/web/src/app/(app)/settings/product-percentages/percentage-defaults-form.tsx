"use client";
import {MAX_PRODUCT_PERCENTAGE_RATE} from "@/lib/product-percentage-rate-limit";
import {useRef,useState} from 'react';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Button} from '@/components/ui/button';
import {DEFAULT_PERCENTAGE_KINDS,defaultsPatchSchema,type DefaultsSnapshot} from '@/server/product-percentage-defaults/contracts';
import {saveProductPercentageDefaultsAction} from '@/server/product-percentage-defaults/actions';
const labels={ENGINEERING:'Инженер, %',ASSEMBLY:'Сборщик, %',INSTALLATION:'Монтажник, %'};
export function PercentageDefaultsForm({initial}:{initial:DefaultsSnapshot}){
 const[baseline,setBaseline]=useState(initial),[draft,setDraft]=useState(Object.fromEntries(DEFAULT_PERCENTAGE_KINDS.map(kind=>[kind,initial.rates[kind]??'']))),[pending,setPending]=useState(false),[error,setError]=useState<string|null>(null),[saved,setSaved]=useState(false),[conflict,setConflict]=useState<DefaultsSnapshot|null>(null);
 const attempt=useRef<{fingerprint:string;input:{rates:Record<string,string|null>;expectedRates:DefaultsSnapshot['rates'];expectedRevision:number;clientMutationId:string}}|null>(null);
 async function submit(){
  if(pending)return;setError(null);setSaved(false);const rates=Object.fromEntries(DEFAULT_PERCENTAGE_KINDS.map(kind=>[kind,draft[kind]===''?null:draft[kind]]));
  const fingerprint=JSON.stringify({rates,baseline});const input=attempt.current?.fingerprint===fingerprint?attempt.current.input:{rates,expectedRates:baseline.rates,expectedRevision:baseline.revision,clientMutationId:crypto.randomUUID()};
  const parsed=defaultsPatchSchema.safeParse(input);if(!parsed.success){setError(parsed.error.issues[0]?.message??'Проверьте проценты');return;}
  attempt.current={fingerprint,input};setPending(true);
  try{const reply=await saveProductPercentageDefaultsAction(input);if(!reply.ok){setError(reply.error);if(reply.current)setConflict(reply.current);return;}setBaseline(reply.snapshot);setDraft(Object.fromEntries(DEFAULT_PERCENTAGE_KINDS.map(kind=>[kind,reply.snapshot.rates[kind]??''])));setConflict(null);attempt.current=null;setSaved(true);}
  catch{setError('Ответ не получен. Повторите сохранение: запрос останется тем же.');}finally{setPending(false);}
 }
 return <div className="flex min-w-0 flex-col gap-4">{DEFAULT_PERCENTAGE_KINDS.map(kind=><div key={kind} className="grid min-w-0 gap-2"><Label htmlFor={`default-${kind}`}>{labels[kind]}</Label><Input id={`default-${kind}`} inputMode="decimal" value={draft[kind]} disabled={pending} placeholder="Без процентной оплаты" onChange={event=>{const value=event.target.value;if(/^[0-9]{0,3}(?:\.[0-9]?)?$/.test(value)&&(value===''||value==='.'||Number(value)<=MAX_PRODUCT_PERCENTAGE_RATE)){setDraft(current=>({...current,[kind]:value}));setSaved(false);}}}/></div>)}<p className="text-sm text-muted-foreground">От 0 до 15, шаг 0.1. Пустое поле — без процентной оплаты; 0 — явная нулевая ставка.</p>{error?<p role="alert" className="text-destructive">{error}</p>:null}{conflict?<Button variant="outline" disabled={pending} onClick={()=>{setBaseline(conflict);setConflict(null);attempt.current=null;setError('Актуальная версия принята. Проверьте свой ввод и сохраните снова.');}}>Принять актуальную версию, сохранив мой ввод</Button>:null}<Button disabled={pending} onClick={()=>void submit()}>{pending?'Сохраняется…':'Сохранить стандартные проценты'}</Button>{saved?<p role="status">Сохранено</p>:null}</div>;
}
