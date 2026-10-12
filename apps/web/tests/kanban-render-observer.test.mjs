import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {KANBAN_RENDER_BINDINGS,observeKanbanRenders} from './kanban-render-observer.mjs';
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(path.join(web,'package.json')),ts=require('typescript');
test('actual current memo functions have exactly fourteen authored bodies and two readonly callback observers',async()=>{
 let bodies=0,callbacks=0;
 for(const binding of KANBAN_RENDER_BINDINGS){const raw=await readFile(path.join(web,binding.relative),'utf8'),observed=observeKanbanRenders(ts,raw,binding);assert.equal(observed.bodies.length,binding.names.length);assert.notEqual(observed.transformedSha256,observed.originalSha256);bodies+=observed.bodies.length;callbacks+=Number(Boolean(binding.callback));const parsed=ts.createSourceFile(binding.relative,observed.contents,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);assert.deepEqual(parsed.parseDiagnostics,[]);}
 assert.equal(bodies,14);assert.equal(callbacks,2);
});
test('missing or duplicate authored bodies fail closed instead of reporting zero renders',()=>{
 const binding=KANBAN_RENDER_BINDINGS[2];assert.throws(()=>observeKanbanRenders(ts,'export function Other(){return null}',binding),/AUTHORED_BODY_MISSING/);assert.throws(()=>observeKanbanRenders(ts,'function ProjectKanbanCard(){return null} function ProjectKanbanCard(){return null}',binding),/DUPLICATE_KANBAN_AUTHORED_BODY/);assert.throws(()=>observeKanbanRenders(ts,'function ProjectKanbanCard(){return null}',{...binding}),/DECLARED_KANBAN_RENDER_BINDING_REQUIRED/);
});
test('counter executes inside memo body, preserving directive prologue and return value',()=>{
 const binding=KANBAN_RENDER_BINDINGS[2],raw='const ProjectKanbanCard = memo(function ProjectKanbanCard(){"use strict"; return 7;});',observed=observeKanbanRenders(ts,raw,binding),counts={};
 const component=Function('memo','globalThis',observed.contents+'; return ProjectKanbanCard;')(fn=>fn,{__KANBAN_BODY_COUNTS__:counts,__KANBAN_CALLBACKS__:{}});assert.equal(component(),7);assert.equal(component(),7);assert.equal(counts[binding.relative+'#ProjectKanbanCard'],2);assert.ok(observed.contents.indexOf('"use strict";')<observed.contents.indexOf('if (!globalThis.'));
});