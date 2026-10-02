import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {recoveryActorBinding} from './product-attachments-recover-runner.mjs';
test('recovery fresh cookies are bound to original actor IDs/roles rather than a new fixture baseline',()=>{
 const checkpoint={actors:{admin:{id:'a',roles:['ADMIN']},engineer:{id:'e',roles:['ENGINEER']}}},profiles={admin:{id:'a',roles:['ADMIN'],cookies:[]},engineer:{id:'e',roles:['ENGINEER']}};assert.equal(recoveryActorBinding(checkpoint,profiles),profiles.admin);assert.throws(()=>recoveryActorBinding(checkpoint,{...profiles,admin:{id:'foreign',roles:['ADMIN']}}),/BINDING_STOP/);assert.throws(()=>recoveryActorBinding(checkpoint,{...profiles,engineer:{id:'e',roles:['MANAGER']}}),/BINDING_STOP/);
});
test('recovery preserves old checkpoints/STOP, never prepares new fixtures, and restores ORIGINAL session only',async()=>{
 const source=await readFile(new URL('./product-attachments-recover-runner.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/execute\(fixtureBytes,'prepare'/);assert.match(source,/fresh\.body\.checkpoint=undefined/);assert.match(source,/checkpoint:originalSession/);assert.match(source,/RECOVERED_OWN_DATA/);assert.match(source,/cleanupAttachmentsUi/);assert.doesNotMatch(source,/s3Delete|DeleteObjectCommand|file\.deleteMany|\.unlink/);
});
test('minimal smoke explicitly defers the visual loops and true zoom',async()=>{
 const browser=await readFile(new URL('./product-attachments-browser.mjs',import.meta.url),'utf8'),runner=await readFile(new URL('./product-attachments-stage-runner.mjs',import.meta.url),'utf8');assert.match(browser,/if\(!skipVisual\)/);assert.match(browser,/VISUAL_DEFERRED/);assert.match(runner,/skipVisual:operation==='smoke'/);assert.match(runner,/operation==='browser'&&browser\?\.status==='PASS'/);
});
