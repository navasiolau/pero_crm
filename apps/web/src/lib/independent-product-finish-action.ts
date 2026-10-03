"use client";
import {createFromFetch,createTemporaryReferenceSet,encodeReply} from "react-server-dom-webpack/client";
import {patchProductFinishAction} from "@/server/product-finishes/actions";
import type {ProductFinishCommand,ProductFinishResult} from "@/server/product-finishes/contracts";
import {createIndependentActionTransport} from "@/lib/independent-action-transport";
// Проверенный компактный протокол Next 15.5.20; исходный зарегистрированный Action.
const call=createIndependentActionTransport({url:()=>{const url=new URL(window.location.href);if(url.origin!==window.location.origin||!/^\/products\/[^/]+$/.test(url.pathname))throw Error("Сохранение доступно только в карточке изделия");return url.href;},fetch:(...args)=>fetch(...args),codec:()=>{const temporaryReferences=createTemporaryReferenceSet();return{encodeReference:reference=>encodeReply(reference),encodeArguments:args=>encodeReply(args,{temporaryReferences}),decode:response=>createFromFetch(Promise.resolve(response),{temporaryReferences,callServer:async()=>{throw Error("Неожиданное действие в ответе поля");}})};}});
export function invokeProductFinishPatch(input:ProductFinishCommand):Promise<ProductFinishResult>{return call(patchProductFinishAction,[input]);}
