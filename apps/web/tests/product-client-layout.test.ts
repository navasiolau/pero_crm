import assert from "node:assert/strict";
import test from "node:test";
import {confirmedProductClientContacts} from "../src/lib/product-client-contacts";
import {productPatchSchema} from "../src/server/products/patch-contract";
import {submitClientEditor} from "../src/lib/client-editor-submit";
test("confirmed selected Client supplies contacts; stale draft/project address cannot substitute",()=>{
 const clients=[{id:"a",label:"A",phone:"100",address:"Client A"},{id:"b",label:"B",phone:"200",address:"Client B"}];
 assert.equal(confirmedProductClientContacts("b",clients,{clientId:"a",phone:"100",clientAddress:"stale"}).address,"Client B");
 assert.equal(confirmedProductClientContacts("new",clients,{clientId:"new",phone:"300",clientAddress:null,clientLabel:"Created"}).phone,"300");
 assert.equal(confirmedProductClientContacts("unknown",clients,{clientId:"a",phone:"100",clientAddress:"Project old"}).known,false);
});
test("retired Product phone/address requests fail closed while client selection still uses CAS",()=>{
 const base={productId:"product",clientMutationId:"00000000-0000-4000-8000-000000000001",expectedValue:"old",value:"new"};
 assert.equal(productPatchSchema.safeParse({...base,field:"project.address"}).success,false);
 assert.equal(productPatchSchema.safeParse({...base,field:"client.phone",expectedClientId:"client"}).success,false);
 assert.equal(productPatchSchema.safeParse({...base,field:"project.clientId"}).success,true);
});
test("shared real CRUD adapter creates once and preserves exact rendered seven-field update baseline",async()=>{
 let created=0,updated=0;const input={name:"New",phone:"100",address:"Address"};let captured:unknown;
 const actions={create:async()=>{created++;return{ok:true,id:"actual-client"}},update:async(_id:string,_input:unknown,baseline:unknown)=>{updated++;captured=baseline;return{ok:true}}};
 assert.equal((await submitClientEditor(input,null,actions)).id,"actual-client");assert.equal(created,1);assert.equal(updated,0);
 const initial={id:"old",name:"Old",phone:"200",lastName:null,middleName:null,email:null,address:"Old street",comment:null,projects:["do not send"]};
 await submitClientEditor(input,initial,actions);assert.deepEqual(captured,{name:"Old",phone:"200",lastName:null,middleName:null,email:null,address:"Old street",comment:null});assert.equal(updated,1);
});
