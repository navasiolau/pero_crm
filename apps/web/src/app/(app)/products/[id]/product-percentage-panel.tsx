"use client";

import {useEffect,useRef,useState,useSyncExternalStore} from "react";
import {useRouter} from "next/navigation";
import {InlineSelectField} from "@/components/inline-fields";
import {PercentageRateInput} from "@/components/percentage-rate-input";
import {type SearchableOption} from "@/components/ui/searchable-select";
import {Button} from "@/components/ui/button";
import {Card,CardContent,CardHeader,CardTitle} from "@/components/ui/card";
import {useOptionalProductInline} from "@/components/product-inline-provider";
import {useInlineSave} from "@/hooks/use-inline-save";
import {createSinglePercentageControllers,getSinglePercentageControllers} from "@/lib/single-percentage-controller";
import {invokeProductPercentagePatch} from "@/lib/independent-product-percentage-action";
import {singleProductPercentagePreview,confirmedPercentageRecipient,percentageRecipientLabel,percentageStageTitle} from "@/lib/single-product-percentage-ui";
import {type ProductPercentageCandidate} from "@/lib/product-percentage-ui";
import {formatAmount} from "@/lib/format";
import type {ProductPercentageKind} from "@/lib/product-percentage-pay";
import type {ProductPercentageSectionView,ProductPercentageView} from "@/lib/product-percentage-view";
import {retryProductPercentageAction} from "@/server/product-percentage-pay/actions";

const noSubscribe=()=>()=>{};
const currentRate=(section:ProductPercentageSectionView)=>section.currentRatePercent===undefined?section.ratePercent:section.currentRatePercent;
export type SinglePercentageRowProps={productId:string;kind:ProductPercentageKind;section:ProductPercentageSectionView;canManage:boolean;canViewAll:boolean;candidates:ProductPercentageCandidate[];assignedEngineerId?:string|null;editEngineer?:boolean};
function PercentageState({field}:{field:ReturnType<typeof useInlineSave>}){
 return <div className="min-w-0 break-words text-xs" aria-live="polite">
  {field.error?<p role="alert" className="text-destructive">{field.error}</p>:<span className="text-muted-foreground">{field.status==="saving"?"Сохраняется…":field.status==="dirty"?"Есть изменения":field.status==="saved"?"Сохранено":""}</span>}
  {field.status==="error"?<Button variant="link" className="h-auto px-0 text-xs" onClick={()=>void field.retry()}>Повторить сохранение</Button>:null}
  {field.status==="conflict"?<div className="flex flex-wrap gap-2"><Button variant="link" className="h-auto px-0 text-xs" onClick={field.acceptCurrent}>Принять сохранённое</Button><Button variant="link" className="h-auto px-0 text-xs" onClick={()=>void field.rebaseAndRetry()}>Сохранить мой ввод</Button></div>:null}
 </div>;
}
export function SinglePercentageRow({productId,kind,section,canManage,canViewAll,candidates,assignedEngineerId,editEngineer=false}:SinglePercentageRowProps){
 const inline=useOptionalProductInline(),router=useRouter();
 const groupRef=useRef<ReturnType<typeof createSinglePercentageControllers>|null>(null);
 if(!groupRef.current){const options={productId,kind,initial:{ratePercent:currentRate(section),assigneeId:section.assignee?.userId??null},revision:section.revision,save:invokeProductPercentagePatch};groupRef.current=inline?getSinglePercentageControllers(inline.controller("quantity"),options):createSinglePercentageControllers(options);}
 const group=groupRef.current;
 useEffect(()=>group.receive({ratePercent:currentRate(section),assigneeId:section.assignee?.userId??null},section.revision),[group,section]);
 const [retryBusy,setRetryBusy]=useState(false),[retryError,setRetryError]=useState<string|null>(null);
 const retryPending=useRef(false);
 useEffect(()=>{
  if(inline)inline.registerGuard(`percentage-${kind}`,async()=>!retryPending.current&&await group.flush());
  // Скрытая вкладка сохраняет очередь и guard, пока жив provider изделия.
 },[inline,kind,group]);
 const rate=useInlineSave(group.controllers.ratePercent),assignee=useInlineSave(group.controllers.assigneeId);
 const priceController=inline?.controller("expectedPrice"),quantityController=inline?.controller("quantity"),engineerController=inline?.controller("engineerId");
 const price=useSyncExternalStore(priceController?.subscribe??noSubscribe,()=>priceController?priceController.getSnapshot().baseline:section.unitPrice??section.price,()=>priceController?priceController.getServerSnapshot().baseline:section.unitPrice??section.price);
 const quantity=useSyncExternalStore(quantityController?.subscribe??noSubscribe,()=>quantityController?quantityController.getSnapshot().baseline:section.quantity??null,()=>quantityController?quantityController.getServerSnapshot().baseline:section.quantity??null);
 const engineer=useSyncExternalStore(engineerController?.subscribe??noSubscribe,()=>engineerController?engineerController.getSnapshot().baseline:assignedEngineerId??section.assignee?.userId??null,()=>engineerController?engineerController.getServerSnapshot().baseline:assignedEngineerId??section.assignee?.userId??null);
 const editable=canManage&&section.canManage;
 const recipientController=kind==="ENGINEERING"?engineerController:group.controllers.assigneeId;
 const recipientId=kind==="ENGINEERING"?engineer:assignee.baseline;
 const label=percentageRecipientLabel(kind);
 const confirmedRecipient=confirmedPercentageRecipient(kind,recipientId===null?null:String(recipientId),candidates,section.recipientCandidates??[],section.assignee);
 const options:SearchableOption[]=kind==="ENGINEERING"?candidates.filter(row=>{const recipient=confirmedPercentageRecipient(kind,row.id,[row],[],null);return recipient.active&&recipient.eligible;}).map(row=>({value:row.id,label:row.name})):section.recipientCandidates?.map(row=>({value:row.userId,label:row.name}))??candidates.filter(row=>{const recipient=confirmedPercentageRecipient(kind,row.id,[row],[],null);return recipient.active&&recipient.eligible;}).map(row=>({value:row.id,label:row.name}));
 if(section.assignee&&!options.some(option=>option.value===section.assignee?.userId))options.push({value:section.assignee.userId,label:section.assignee.name,disabled:!section.assignee.active||!section.assignee.eligible});
  const engineerName=confirmedRecipient.name;
  const version=section.calculationVersion??4;
  const unitPrice=price===null?null:String(price),confirmedQuantity=quantity===null?null:Number(quantity);
  const previewTotal=version>=2&&section.productCurrency!=="BYN"?null:singleProductPercentagePreview({state:section.state,kind,version,unitPrice,quantity:confirmedQuantity,rate:rate.baseline===null?null:String(rate.baseline),frozenTotal:section.total,recipientEligible:confirmedRecipient.active&&confirmedRecipient.eligible});
  // Сумма закреплённого специалиста видна при любом статусе изделия; в зарплату
  // записывается только сменой статуса. Процент виден только при canViewAll.
  const ownAmount=section.ownMember?.amount??section.members[0]?.amount??null;
  const displaySum=canViewAll?(previewTotal??section.total):(ownAmount??(section.assignee?null:section.total));
  const rateMissing=currentRate(section)===null&&(section.state==="DRAFT"||section.state==="SKIPPED_ONCE");
  const showSum=displaySum!==null||rateMissing;
  // Поле без финансового обзора видит этап одной текстовой строкой: имя назначенного
  // и только своя оплата; ни полей %, ни селектов.
  if(!canViewAll){
   const name=section.assignee?.name??"Не назначен";
   return <section aria-label={`${label}: процентная оплата`} data-single-percentage-kind={kind} className="min-w-0"><p className="min-w-0 break-words text-sm"><span className="font-medium">{label}:</span> <span>{ownAmount!==null?`${name};`:name}</span>{ownAmount!==null?<span className="ml-2"><span className="text-muted-foreground">Оплата:</span> <span className="font-semibold text-primary tabular-nums">{formatAmount(ownAmount,version>=2?"BYN":section.productCurrency)}</span></span>:null}</p></section>;
  }
 async function retryFrozen(){
  if(retryPending.current)return;retryPending.current=true;setRetryBusy(true);setRetryError(null);
  try{if(!await group.flush())throw Error("Сначала сохраните текущие поля этапа");const result=await retryProductPercentageAction({productId,kind});if(!result.ok)throw Error(result.error??"Не удалось повторить расчёт");router.refresh();}catch(error){setRetryError(error instanceof Error?error.message:"Не удалось повторить расчёт");}finally{retryPending.current=false;setRetryBusy(false);}
 }
  return <section aria-label={`${label}: процентная оплата`} data-single-percentage-kind={kind} className="min-w-0 space-y-3">
   <div className="flex min-w-0 flex-nowrap items-start gap-3">
    <div data-percentage-payment className="w-36 max-w-36 min-w-0 shrink-0" onKeyDownCapture={event=>{if(event.key==="Escape"){event.preventDefault();void group.cancel("ratePercent");}}}>
     {canViewAll?<><PercentageRateInput id={`${kind.toLowerCase()}-rate`} label="Процент, %" draft={rate.draft} setDraft={rate.setDraft} commit={rate.commit} error={Boolean(rate.error)} readOnly={!editable} />
     <div id={`${kind.toLowerCase()}-rate-state`}><PercentageState field={rate}/></div>
     {rateMissing?<p className="mt-1 min-w-0 break-words text-xs text-amber-700">Ставка не задана — проверьте стандартные проценты</p>:null}</>:null}
     {showSum?<p data-percentage-amount className="mt-2 min-w-0 break-words text-[18px] leading-6 font-semibold text-primary tabular-nums">Сумма: {displaySum===null?"—":formatAmount(displaySum,version>=2?"BYN":section.productCurrency)}</p>:null}
    </div>
   <div data-percentage-recipient className="w-60 max-w-60 min-w-0 shrink">{kind==="ENGINEERING"&&!editEngineer?<div className="space-y-1.5 text-sm"><span className="font-medium">Инженер</span><p className="break-words">{engineerName??"Не назначен"}</p></div>:recipientController?<InlineSelectField id={`${kind.toLowerCase()}-assignee`} label={label} controller={recipientController} readOnly={!editable} options={options} allowClear />:<p>{section.assignee?.name??"Не назначен"}</p>}</div>
  </div>
  {confirmedRecipient.userId!==null&&(!confirmedRecipient.active||!confirmedRecipient.eligible)?<p className="break-words text-xs text-muted-foreground">Текущий получатель не подходит для нового начисления. Назначьте активного сотрудника соответствующей роли.</p>:null}
  {section.state==="PENDING_FX"&&canManage?<Button variant="outline" disabled={retryBusy} onClick={()=>void retryFrozen()}>Повторить расчёт снимка</Button>:null}
  {retryError?<p role="alert" className="break-words text-sm text-destructive">{retryError}</p>:null}
 </section>;
}
export function ProductPercentagePanel({view,assignedEngineerId,canManage,canViewAll,engineers,mounters,assemblers=[]}:{view:ProductPercentageView;assignedEngineerId:string|null;canManage:boolean;canViewAll:boolean;engineers:ProductPercentageCandidate[];mounters:ProductPercentageCandidate[];assemblers?:ProductPercentageCandidate[]}){
 return <section className="min-w-0 space-y-4" aria-label="Процентные этапы изделия">{(["ENGINEERING","ASSEMBLY","INSTALLATION"] as const).map(kind=><Card key={`${view.productId}:${kind}`} className="min-w-0"><CardHeader><CardTitle>{percentageStageTitle(kind)}</CardTitle></CardHeader><CardContent className="min-w-0"><SinglePercentageRow productId={view.productId} kind={kind} section={view.sections[kind]} canManage={canManage} canViewAll={canViewAll} candidates={kind==="ENGINEERING"?engineers:kind==="ASSEMBLY"?assemblers:mounters} assignedEngineerId={assignedEngineerId} /></CardContent></Card>)}</section>;
}
