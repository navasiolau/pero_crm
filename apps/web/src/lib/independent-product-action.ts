"use client";
import { createFromFetch, createTemporaryReferenceSet, encodeReply } from "react-server-dom-webpack/client";
import { patchProduct } from "@/server/products/actions";
import type { ProductPatch, ProductPatchResult } from "@/server/products/patch-contract";
import { createIndependentActionTransport } from "@/lib/independent-action-transport";

// Используется проверенный протокол Server Action/React Flight Next 15.5.20.
// ID исходного зарегистрированного export получаем публичным encodeReply:
// без константных IDs, private-свойств функции, пользовательских URLs и API fork.
// Обычный Next callServer ставит ответы полей в общую router-очередь.
// Этот transport принимает только компактный результат и не вызывает router dispatch.
const call = createIndependentActionTransport({
  url: () => {
    const url = new URL(window.location.href);
    if (url.origin !== window.location.origin || !/^\/products\/[^/]+$/.test(url.pathname)) throw Error("Сохранение доступно только в карточке изделия");
    return url.href;
  },
  fetch: (...args) => fetch(...args),
  codec: () => {
    const temporaryReferences = createTemporaryReferenceSet();
    return {
      encodeReference: reference => encodeReply(reference),
      encodeArguments: args => encodeReply(args, { temporaryReferences }),
      decode: response => createFromFetch(Promise.resolve(response), {
        temporaryReferences,
        callServer: async () => { throw Error("В ответе поля обнаружено неожиданное серверное действие"); },
      }),
    };
  },
});
export function invokeProductPatch(input: ProductPatch): Promise<ProductPatchResult> { return call(patchProduct, [input]); }
