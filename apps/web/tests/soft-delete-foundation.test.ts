import assert from "node:assert/strict";
import { test } from "node:test";
import { isConfirmedProductDelete } from "../src/lib/product-delete-ui";
import { isConfirmedProjectDelete } from "../src/lib/project-delete-ui";

{ // Источник: product-delete-ui.test.ts
const request={productId:'p',expectedUpdatedAt:'2026-10-03T10:00:00.000Z',clientMutationId:'12222222-2222-4222-8222-222222222222'},ack={ok:true,productId:'p',projectId:'j',deletedAt:'2026-10-03T11:00:00.000Z',clientMutationId:request.clientMutationId};
test('only actual matched delete/replay ACK permits leaving hidden product; malformed/stale responses remain unconfirmed',()=>{assert.equal(isConfirmedProductDelete(ack,request),true);assert.equal(isConfirmedProductDelete({...ack,repeated:true},request),true);for(const value of [null,{...ack,ok:false},{...ack,productId:'foreign'},{...ack,clientMutationId:'other'},{...ack,deletedAt:'invalid'},{...ack,deletedAt:''},{...ack,projectId:''}])assert.equal(isConfirmedProductDelete(value,request),false);});
}

{ // Источник: project-delete-ui.test.ts
const input={projectId:'j',expectedUpdatedAt:'2026-10-03T10:00:00.000Z',expectedProductsVersion:'a'.repeat(64),clientMutationId:'12222222-2222-4222-8222-222222222222'},ack={ok:true,projectId:'j',deletedAt:'2026-10-03T11:00:00.000Z',clientMutationId:input.clientMutationId,affectedProductIds:['p']};
test('owner exact warning and actual matched project ACK/replay; stale/malformed responses never confirm navigation',()=>{assert.equal(isConfirmedProjectDelete(ack,input),true);assert.equal(isConfirmedProjectDelete({...ack,repeated:true},input),true);for(const value of [null,{...ack,ok:false},{...ack,projectId:'foreign'},{...ack,clientMutationId:'wrong'},{...ack,deletedAt:'invalid'},{...ack,affectedProductIds:null}])assert.equal(isConfirmedProjectDelete(value,input),false);});
}
