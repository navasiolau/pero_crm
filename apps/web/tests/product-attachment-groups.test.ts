import test from 'node:test';
import assert from 'node:assert/strict';
import {productAttachmentGroups} from '../src/lib/product-attachment-groups';

test('sections preserve original objects and order and keep product general/task files visible',()=>{
 const files=Object.freeze([
  Object.freeze({id:'assembly-migrated',section:'PRODUCTION',storedName:'unchanged-assembly'}),
  Object.freeze({id:'task-general',section:'GENERAL',taskId:'task',storedName:'unchanged-task'}),
  Object.freeze({id:'sketch',section:'PRODUCTION'}),
  Object.freeze({id:'install',section:'INSTALLATION'}),
  Object.freeze({id:'measure',section:'MEASUREMENT'}),
 ]);
 const groups=productAttachmentGroups(files,'sketch');
 assert.deepEqual(groups.production,[files[0],files[1]]);assert.deepEqual(groups.installation,[files[3]]);assert.deepEqual(groups.measurement,[files[4]]);
 const visible=[...groups.measurement,...groups.production,...groups.installation];assert.equal(visible.length,4);assert.equal(new Set(visible.map(file=>file.id)).size,4);groups.production.forEach((file,i)=>assert.strictEqual(file,files[i]));
});
test('current sketch originally selected from measurement never appears twice',()=>{
 const cover=Object.freeze({id:'measurement-sketch',section:'MEASUREMENT',storedName:'same-key'}),ordinary=Object.freeze({id:'ordinary',section:'PRODUCTION'});
 const groups=productAttachmentGroups([cover,ordinary],cover.id);assert.deepEqual(groups.measurement,[]);assert.deepEqual(groups.production,[ordinary]);assert.deepEqual(groups.installation,[]);
});
test('previous sketch becomes its ordinary section attachment after replacement',()=>{
 const old=Object.freeze({id:'old-sketch',section:'PRODUCTION',storedName:'unchanged-key'}),current=Object.freeze({id:'new-sketch',section:'PRODUCTION'});
 const groups=productAttachmentGroups([old,current],current.id);assert.deepEqual(groups.production,[old]);assert.strictEqual(groups.production[0],old);
});
