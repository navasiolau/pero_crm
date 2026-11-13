"use client";
import {createContext,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import type {TechnicalSpecifications} from "@pero/kp-template";
import {createInlineSaveController,type InlineSaveController,type InlineValue} from "@/lib/inline-save-controller";
import {productPatchSchema,type ProductPatchField,type ProductPatchDerived} from "@/server/products/patch-contract";
import {invokeProductPatch} from "@/lib/independent-product-action";
import {normalizeProductDescription} from "@/lib/product-description";
import {isUnchangedProductDescriptionDraft} from "@/lib/product-description-draft";
import {flushProductStatusBarrier} from "@/lib/product-status-barrier";
import {createProductTechnicalEditor} from "@/lib/product-technical-editor";
type ActiveField=Exclude<ProductPatchField,"client.phone"|"project.address"|"technicalSpecificationValue"|"technicalSpecificationSource"|"technicalSpecificationAdd"|"technicalSpecificationRemove"|"technicalSpecificationEntry"|"technicalSpecificationRow">;
export type ProductInlineInitial=Record<ActiveField,InlineValue>;
type Context={controller:(field:ActiveField)=>InlineSaveController;technical:ReturnType<typeof createProductTechnicalEditor>;flush:()=>Promise<boolean>;registerGuard:(key:string,guard:()=>Promise<boolean>)=>()=>void;derived:ProductPatchDerived;clientId:string;sourceClientId:string};
const InlineContext=createContext<Context|null>(null);
function parse(field:ActiveField,raw:string):InlineValue{
 if(field==="description")return normalizeProductDescription(raw);const value=raw.trim();
 if(field==="quantity"){const n=Number(value);if(!value||!Number.isInteger(n)||n<1||n>2147483647)throw Error("Количество — целое число от1 до2147483647");return n;}
 if(field==="expectedPrice"){if(!value)return null;const decimal=value.replace(",",".");if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(decimal))throw Error("Введите неотрицательную цену с точностью до копеек");const[whole,fraction=""]=decimal.split(".");return`${BigInt(whole)}.${fraction.padEnd(2,"0")}`;}
 if(field==="title"||field==="project.clientId"){if(!value)throw Error("Заполните обязательное поле");return value;}return value||null;
}
export function ProductInlineProvider({productId,initial,technicalSpecifications=null,children}:{productId:string;initial:ProductInlineInitial;technicalSpecifications?:TechnicalSpecifications|null;children:ReactNode}){
 const guards=useRef(new Map<string,()=>Promise<boolean>>());const[derived,setDerived]=useState<ProductPatchDerived>({clientId:String(initial["project.clientId"])});
 const controllers=useMemo(()=>{
  const result=new Map<ActiveField,InlineSaveController>();for(const field of Object.keys(initial) as ActiveField[]){
   result.set(field,createInlineSaveController<InlineValue>({initialValue:field==="expectedPrice"&&initial[field]!==null?parse(field,String(initial[field])):initial[field],format:value=>value===null?"":String(value),parse:raw=>parse(field,raw),isUnchangedDraft:field==="description"?(draft,baseline)=>isUnchangedProductDescriptionDraft(draft,baseline===null?null:String(baseline)):undefined,
    save:async request=>{const reply=await invokeProductPatch(productPatchSchema.parse({productId,field,...request}));if(reply.kind==="saved"&&reply.derived)setDerived(previous=>({...previous,...reply.derived}));if(reply.kind==="saved"){if(reply.value!==null&&typeof reply.value==="object")throw Error("Неверный ответ поля изделия");return{...reply,value:reply.value};}const currentValue="currentValue" in reply?reply.currentValue:undefined;return{...reply,currentValue:currentValue!==null&&typeof currentValue==="object"?undefined:currentValue};},
   }));
  }return result;
  // Независимые RSC не заменяют черновики и исходные CAS baselines изделия.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[productId]);
 const technical=useMemo(()=>createProductTechnicalEditor({
  productId,initial:technicalSpecifications,send:invokeProductPatch,
  // Серверные обновления передаются контроллерам через receive.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }),[productId]);
 useEffect(()=>{
  technical.receive(technicalSpecifications);
 },[technical,technicalSpecifications]);
 const value=useMemo<Context>(()=>({
  controller:field=>{const controller=controllers.get(field);if(!controller)throw Error("Неизвестное поле изделия");return controller;},
  technical,
  flush:()=>flushProductStatusBarrier(
   [...controllers].filter(([field])=>field!=="description").map(([,controller])=>controller),
   [technical.flush,...guards.current.values()],
  ),
  registerGuard:(key,guard)=>{guards.current.set(key,guard);return()=>{if(guards.current.get(key)===guard)guards.current.delete(key);};},
  derived,clientId:derived.clientId??String(initial["project.clientId"]),sourceClientId:String(initial["project.clientId"]),
 }),[controllers,derived,initial,technical]);
 return<InlineContext.Provider value={value}>{children}</InlineContext.Provider>;
}
export function useProductInline(){const value=useContext(InlineContext);if(!value)throw Error("ProductInlineProvider required");return value;}
export function useOptionalProductInline(){return useContext(InlineContext);}
