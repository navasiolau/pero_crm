import {createInlineSaveController,type InlineSaveController,type InlineValue} from "./inline-save-controller";
import {parsePercentageRate} from "./product-percentage-pay";
import {productPercentagePatchSchema,readWorkReview,type ProductPercentagePatch,type ProductPercentagePatchResult,type WorkReviewItem} from "@/server/product-percentage-pay/contracts";
type Field=ProductPercentagePatch["field"];
type Initial={ratePercent:string|null;assigneeId:string|null;workReview:WorkReviewItem[]};
const cachedGroups=new WeakMap<object,Map<string,ReturnType<typeof createSinglePercentageControllers>>>();
export function getSinglePercentageControllers(owner:object,options:Parameters<typeof createSinglePercentageControllers>[0]){
 let groups=cachedGroups.get(owner);if(!groups){groups=new Map();cachedGroups.set(owner,groups);}
 const key=`${options.productId}:${options.kind}`;let group=groups.get(key);
 if(!group){group=createSinglePercentageControllers(options);groups.set(key,group);}
 return group;
}
export function createSinglePercentageControllers(options:{productId:string;kind:ProductPercentagePatch["kind"];initial:Initial;revision:number;workIds:string[];save:(input:ProductPercentagePatch)=>Promise<ProductPercentagePatchResult>;id?:()=>string}){
 let revision=options.revision,tail=Promise.resolve();
 let blocked:{kind:"conflict";revision:number}|{kind:"uncertain";id:string}|null=null;
 const envelopes=new Map<string,ProductPercentagePatch>();
 const conflicts=new Map<Field,number>();
 let workIds=[...options.workIds];
 const initial:Record<Field,InlineValue>={ratePercent:options.initial.ratePercent,assigneeId:options.initial.assigneeId,workReview:JSON.stringify(options.initial.workReview)};
 function decode(field:Field,value:InlineValue):string|null|WorkReviewItem[]{
  if(field!=="workReview"){if(value!==null&&typeof value!=="string")throw Error("Некорректное значение поля");return value;}
  if(typeof value!=="string")throw Error("Проверьте классификацию работ");
  return readWorkReview(JSON.parse(value));
 }
 const format=(value:InlineValue)=>value===null?"":String(value);
 const encode=(value:string|null|WorkReviewItem[]):InlineValue=>Array.isArray(value)?JSON.stringify(value):value;
 const controllers={} as Record<Field,InlineSaveController>;
 for(const field of ["ratePercent","assigneeId","workReview"] as const){
  controllers[field]=createInlineSaveController<InlineValue>({initialValue:initial[field],format,id:options.id,
   isUnchangedDraft:(draft,baseline)=>draft===format(baseline),
   parse:raw=>{
    if(field==="ratePercent"){const rate=parsePercentageRate(raw.trim()?raw.trim().replace(",","."):null);return rate===null?null:rate.replace(/(\.\d*?)0+$/,"$1").replace(/\.$/,"");}
    if(field==="assigneeId")return raw||null;
    const rows=readWorkReview(JSON.parse(raw));
    if(rows.length!==workIds.length||workIds.some(id=>!rows.some(row=>row.workId===id)))throw Error("Выберите решение для каждой прежней работы");
    return JSON.stringify(rows);
   },
   onRebase:()=>{const actual=conflicts.get(field);if(actual!==undefined){revision=actual;blocked=null;conflicts.delete(field);}},
   save:request=>{
    const operation=tail.then(async()=>{
     if(blocked&&!(blocked.kind==="uncertain"&&blocked.id===request.clientMutationId))return{kind:"validation" as const,error:"Сначала разрешите конфликт или повторите неподтверждённый запрос этого этапа."};
     let envelope=envelopes.get(request.clientMutationId);
     if(!envelope){envelope=productPercentagePatchSchema.parse({productId:options.productId,kind:options.kind,field,value:decode(field,request.value),expectedValue:decode(field,request.expectedValue),expectedRevision:revision,clientMutationId:request.clientMutationId});envelopes.set(request.clientMutationId,envelope);}
     let result:ProductPercentagePatchResult;
     try{result=await options.save(envelope)}catch(error){blocked={kind:"uncertain",id:request.clientMutationId};throw error;}
     if(result.kind==="saved"){
      if(result.clientMutationId!==request.clientMutationId||result.field!==field||!Number.isSafeInteger(result.revision)||result.revision<0){blocked={kind:"uncertain",id:request.clientMutationId};throw Error("Не получено подтверждение поля");}
      revision=Math.max(revision,result.revision);blocked=null;envelopes.delete(request.clientMutationId);
      return{kind:"saved" as const,value:encode(result.value)};
     }
     envelopes.delete(request.clientMutationId);
     if(result.kind==="conflict"){blocked={kind:"conflict",revision:result.currentRevision};conflicts.set(field,result.currentRevision);return{kind:"conflict" as const,error:result.error,currentValue:encode(result.currentValue)};}
     return{kind:result.kind,error:result.error};
    });
    // Строгий revision CAS требует FIFO внутри одного этапа, не общей router-очереди.
    tail=operation.then(()=>undefined,()=>undefined);
    return operation;
   },
  });
 }
 return{
  controllers,
  receive(next:Initial,nextRevision:number,nextWorkIds?:string[]){
   if(nextRevision<revision)return;
   revision=nextRevision;if(nextWorkIds)workIds=[...nextWorkIds];controllers.ratePercent.receive(next.ratePercent);controllers.assigneeId.receive(next.assigneeId);controllers.workReview.receive(JSON.stringify(next.workReview));
  },
  async flush(){return(await Promise.all(Object.values(controllers).map(controller=>controller.flush()))).every(Boolean)},
  async cancel(field:Field){const controller=controllers[field],state=controller.getSnapshot();if(blocked?.kind==="uncertain"||state.status==="saving"||state.status==="conflict")return false;controller.setDraft(format(state.baseline));return controller.retry();},
 };
}
