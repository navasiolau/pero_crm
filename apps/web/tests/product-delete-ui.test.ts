import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isConfirmedProductDelete} from '../src/lib/product-delete-ui';
const request={productId:'p',expectedUpdatedAt:'2026-10-03T10:00:00.000Z',clientMutationId:'12222222-2222-4222-8222-222222222222'},ack={ok:true,productId:'p',projectId:'j',deletedAt:'2026-10-03T11:00:00.000Z',clientMutationId:request.clientMutationId};
test('only actual matched delete/replay ACK permits leaving hidden product; malformed/stale responses remain unconfirmed',()=>{assert.equal(isConfirmedProductDelete(ack,request),true);assert.equal(isConfirmedProductDelete({...ack,repeated:true},request),true);for(const value of [null,{...ack,ok:false},{...ack,productId:'foreign'},{...ack,clientMutationId:'other'},{...ack,deletedAt:'invalid'},{...ack,deletedAt:''},{...ack,projectId:''}])assert.equal(isConfirmedProductDelete(value,request),false);});
