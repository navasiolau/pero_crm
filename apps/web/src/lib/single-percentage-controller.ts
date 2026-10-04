import {createInlineSaveController,type InlineSaveController,type InlineValue} from "./inline-save-controller";
import {parsePercentageInput} from "./percentage-rate-input";
import {flushSketchCriticalFields} from "./product-sketch-ui";
import {productPercentagePatchSchema,type ProductPercentagePatch,type ProductPercentagePatchResult} from "@/server/product-percentage-pay/contracts";
type Field=ProductPercentagePatch["field"];
type Initial={ratePercent:string|null;assigneeId:string|null};
const cachedGroups=new WeakMap<object,Map<string,ReturnType<typeof createSinglePercentageControllers>>>();
export function getSinglePercentageControllers(owner:object,options:Parameters<typeof createSinglePercentageControllers>[0]){
 let groups=cachedGroups.get(owner);if(!groups){groups=new Map();cachedGroups.set(owner,groups);}
 const key=`${options.productId}:${options.kind}`;let group=groups.get(key);
 if(!group){group=createSinglePercentageControllers(options);groups.set(key,group);}
 return group;
}
export function createSinglePercentageControllers(options:{productId:string;kind:ProductPercentagePatch["kind"];initial:Initial;revision:number;save:(input:ProductPercentagePatch)=>Promise<ProductPercentagePatchResult>;id?:()=>string}){
 let revision=options.revision,tail=Promise.resolve();
 let blocked:{kind:"conflict";revision:number}|{kind:"uncertain";id:string}|null=null;
 const envelopes=new Map<string,ProductPercentagePatch>();
 const conflicts=new Map<Field,number>();
 const initial:Record<Field,InlineValue>={ratePercent:options.initial.ratePercent,assigneeId:options.initial.assigneeId};
 function decode(value:InlineValue):string|null{if(value!==null&&typeof value!=="string")throw Error("Некорректное значение поля");return value;}
 const format=(value:InlineValue)=>value===null?"":String(value);
 const controllers={} as Record<Field,InlineSaveController>;
 for(const field of ["ratePercent","assigneeId"] as const){
  controllers[field]=createInlineSaveController<InlineValue>({initialValue:initial[field],format,id:options.id,
   isUnchangedDraft:(draft,baseline)=>draft===format(baseline),
   parse:raw=>{
    if(field==="ratePercent"){const rate=parsePercentageInput(raw);return rate===null?null:rate.replace(/(\.\d*?)0+$/,"$1").replace(/\.$/,"");}
    return raw||null;
   },
   onRebase:()=>{const actual=conflicts.get(field);if(actual!==undefined){revision=actual;blocked=null;conflicts.delete(field);}},
   save:request=>{
    const operation=tail.then(async()=>{
     if(blocked&&!(blocked.kind==="uncertain"&&blocked.id===request.clientMutationId))return{kind:"validation" as const,error:"Сначала разрешите конфликт или повторите неподтверждённый запрос этого этапа."};
     let envelope=envelopes.get(request.clientMutationId);
     if(!envelope){envelope=productPercentagePatchSchema.parse({productId:options.productId,kind:options.kind,field,value:decode(request.value),expectedValue:decode(request.expectedValue),expectedRevision:revision,clientMutationId:request.clientMutationId});envelopes.set(request.clientMutationId,envelope);}
     let result:ProductPercentagePatchResult;
     try{result=await options.save(envelope)}catch(error){blocked={kind:"uncertain",id:request.clientMutationId};throw error;}
     if(result.kind==="saved"){
      if(result.clientMutationId!==request.clientMutationId||result.field!==field||!Number.isSafeInteger(result.revision)||result.revision<0){blocked={kind:"uncertain",id:request.clientMutationId};throw Error("Не получено подтверждение поля");}
      revision=Math.max(revision,result.revision);blocked=null;envelopes.delete(request.clientMutationId);
      return{kind:"saved" as const,value:result.value};
     }
     envelopes.delete(request.clientMutationId);
     if(result.kind==="conflict"){blocked={kind:"conflict",revision:result.currentRevision};conflicts.set(field,result.currentRevision);return{kind:"conflict" as const,error:result.error,currentValue:result.currentValue};}
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
  receive(next:Initial,nextRevision:number){
   if(nextRevision<revision)return;
   revision=nextRevision;controllers.ratePercent.receive(next.ratePercent);controllers.assigneeId.receive(next.assigneeId);
  },
  async flush(){return flushSketchCriticalFields(Object.values(controllers))},
  async cancel(field:Field){const controller=controllers[field],state=controller.getSnapshot();if(blocked?.kind==="uncertain"||state.status==="saving"||state.status==="conflict")return false;controller.setDraft(format(state.baseline));return controller.retry();},
 };
}
