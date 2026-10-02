"use client";
import {createFromFetch,createTemporaryReferenceSet,encodeReply} from "react-server-dom-webpack/client";
import {patchProductPercentageAction} from "@/server/product-percentage-pay/actions";
import type {ProductPercentagePatch,ProductPercentagePatchResult} from "@/server/product-percentage-pay/contracts";
import {createIndependentActionTransport} from "@/lib/independent-action-transport";
// Проверенный компактный протокол Next 15.5.20; исходный зарегистрированный Action.
const call=createIndependentActionTransport({url:()=>{const url=new URL(window.location.href);if(url.origin!==window.location.origin||!/^\/products\/[^/]+$/.test(url.pathname))throw Error("Сохранение доступно только в карточке изделия");return url.href;},fetch:(...args)=>fetch(...args),codec:()=>{const temporaryReferences=createTemporaryReferenceSet();return{encodeReference:reference=>encodeReply(reference),encodeArguments:args=>encodeReply(args,{temporaryReferences}),decode:response=>createFromFetch(Promise.resolve(response),{temporaryReferences,callServer:async()=>{throw Error("Неожиданное действие в ответе поля");}})};}});
export function invokeProductPercentagePatch(input:ProductPercentagePatch):Promise<ProductPercentagePatchResult>{return call(patchProductPercentageAction,[input]);}
