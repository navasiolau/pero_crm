import type { ProductPercentageState } from "./product-percentage-view";
import { previewProductPercentageShare } from "./product-percentage-ui";
import { PERCENTAGE_SHARE_UNITS, parsePercentageRate } from "./product-percentage-pay";
import type { ProductPercentageKind } from "./product-percentage-pay";
import type { ProductPercentageSectionView } from "./product-percentage-view";
import type { ProductPercentageCandidate } from "./product-percentage-ui";
import type { Role } from "@prisma/client";
import {hasRole} from "./roles";
const recipientRole:Record<ProductPercentageKind,Role>={ENGINEERING:"ENGINEER",ASSEMBLY:"WORKER",INSTALLATION:"MOUNTER"};
export const percentageRecipientLabel=(kind:ProductPercentageKind)=>({ENGINEERING:"Инженер",ASSEMBLY:"Сборщик",INSTALLATION:"Монтажник"})[kind];
export const percentageStageTitle=(kind:ProductPercentageKind)=>({ENGINEERING:"Инженерный этап",ASSEMBLY:"Сборочный этап",INSTALLATION:"Монтажный этап"})[kind];
export function confirmedPercentageRecipient(kind:ProductPercentageKind,id:string|null,candidates:ProductPercentageCandidate[],eligibleCandidates:NonNullable<ProductPercentageSectionView["recipientCandidates"]>,previous:ProductPercentageSectionView["assignee"]){
  if(id===null)return{userId:null,name:null,active:false,eligible:false};
  const candidate=candidates.find(row=>row.id===id);
  if(candidate)return{userId:id,name:candidate.name,active:candidate.active,eligible:hasRole([...candidate.roles] as Role[],recipientRole[kind])};
  const eligible=eligibleCandidates.find(row=>row.userId===id);
  if(eligible)return{userId:id,name:eligible.name,active:true,eligible:true};
  if(previous?.userId===id)return previous;
  return{userId:id,name:null,active:false,eligible:false};
}
export function productPercentageBase(unitPrice:string|null,quantity:number|null):string|null{
  if(unitPrice===null||quantity===null||!Number.isSafeInteger(quantity)||quantity<1||!/^\d+(?:\.\d{1,2})?$/.test(unitPrice))return null;
  const [whole,fraction=""]=unitPrice.split(".");
  const cents=(BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,"0")))*BigInt(quantity);
  return `${cents/BigInt(100)}.${String(cents%BigInt(100)).padStart(2,"0")}`;
}
export function singleProductPercentagePreview(input:{state:ProductPercentageState;version:1|2;unitPrice:string|null;quantity:number|null;rate:string|null;frozenTotal:string|null;recipientEligible?:boolean}):string|null{
  if(input.state!=="DRAFT")return input.frozenTotal;
  if(input.recipientEligible===false&&input.rate!==null){try{if(Number(parsePercentageRate(input.rate))>0)return null;}catch{return null;}}
  if(input.version===1)return previewProductPercentageShare(input.unitPrice,input.rate,PERCENTAGE_SHARE_UNITS);
  const base=productPercentageBase(input.unitPrice,input.quantity);
  if(base===null||input.rate===null)return null;
  let rate:string|null;try{rate=parsePercentageRate(input.rate)}catch{return null}
  if(rate===null)return null;
  const cents=BigInt(base.replace(".",""));
  const result=(cents*BigInt(rate.replace(".",""))+BigInt(5000))/BigInt(10000);
  return `${result/BigInt(100)}.${String(result%BigInt(100)).padStart(2,"0")}`;
}
