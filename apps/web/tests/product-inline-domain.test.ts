import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { patchProductCore } from "../src/server/products/core";
import { productPatchSchema, type ProductPatch } from "../src/server/products/patch-contract";
import type { TaskTransaction } from "../src/server/tasks/transaction";
const actor = { id: "m", name: "M", roles: ["MANAGER" as const], source: "web" as const };
const patch = (extra: Partial<ProductPatch> = {}): ProductPatch => ({ productId: "p", field: "title", value: "New", expectedValue: "Old", clientMutationId: randomUUID(), ...extra } as ProductPatch);

test("closed schemas reject wrong field/money/quantity and retired delegated phone/address", () => {
  assert.equal(productPatchSchema.safeParse({ ...patch(), field: "currency" }).success, false);
  assert.equal(productPatchSchema.safeParse(patch({ field: "expectedPrice", value: "-1", expectedValue: "10" })).success, false);
  assert.equal(productPatchSchema.safeParse(patch({ field: "quantity", value: 1.2, expectedValue: 1 })).success, false);
  assert.equal(productPatchSchema.safeParse({ ...patch(), field: "client.phone", value: "", expectedValue: "", expectedClientId: "c" }).success, false);
  assert.equal(productPatchSchema.safeParse({ ...patch(), field: "client.phone", value: "+375", expectedValue: "", expectedClientId: "c" }).success, false);
});

test("retired product contacts reject before transaction and disclose no client metadata", async () => {
  let calls=0;
  const transaction:TaskTransaction=async()=>{calls++;throw new Error("unexpected data access");};
  for(const roles of [["MANAGER"],["ACCOUNTANT"]] as const) {
    const input:ProductPatch={productId:"p",field:"client.phone",value:"draft",expectedValue:"old-phone",expectedClientId:"old",clientMutationId:randomUUID()};
    const result=await patchProductCore({...actor,roles:[...roles]},input,transaction);
    assert.equal(result.kind,"validation");
    assert.equal('currentClientId' in result,false);assert.equal('currentValue' in result,false);
  }
  assert.equal(calls,0);
});


test("malformed envelopes return validation without touching a transaction", async () => {
  let calls=0;
  const transaction:TaskTransaction=async()=>{calls++;throw new Error("must not access DB");};
  for(const input of [null,undefined,"invalid",42,true,[],{}, {field:"title",value:"New",expectedValue:"Old"}]) {
    const result=await patchProductCore(actor,input as ProductPatch,transaction);
    assert.equal(result.kind,"validation");
    assert.equal('currentValue' in result,false);
  }
  assert.equal(calls,0);
});
