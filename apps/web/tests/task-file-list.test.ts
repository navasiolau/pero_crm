import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire,Module} from 'node:module';
import * as React from 'react';
import type {TaskDetails} from '../src/lib/task-details';
import type {FileList} from '../src/components/file-list';
const require=createRequire(import.meta.url),states:unknown[]=[];let cursor=0,refreshes=0,closed=0,deleteOk=true;
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
const hooks={...React,useState:(initial:unknown)=>{const index=cursor++;if(!Object.hasOwn(states,index))states[index]=typeof initial==='function'?(initial as ()=>unknown)():initial;return[states[index],(next:unknown)=>{states[index]=typeof next==='function'?(next as (before:unknown)=>unknown)(states[index]):next;}];},useRef:(initial:unknown)=>{const index=cursor++;if(!Object.hasOwn(states,index))states[index]={current:initial};return states[index];},useTransition:()=>[false,(fn:()=>void)=>fn()]};
inject('react',hooks);Object.assign(globalThis,{React});
inject('next/navigation',{useRouter:()=>({refresh(){refreshes++;}})});
inject('../src/components/file-list',{FileList:'file-list'});
inject('../src/components/ui/dialog',{Dialog:'dialog-root',DialogContent:'dialog-content',DialogHeader:'div',DialogTitle:'h2',DialogDescription:'p',DialogFooter:'footer'});
inject('../src/server/files/actions',{deleteFile:async()=>({ok:deleteOk,error:deleteOk?undefined:'Отказ'})});
inject('../src/server/tasks/actions',{deleteTask(){throw Error('TASK_MUTATION_FORBIDDEN')},updateTask(){throw Error('TASK_MUTATION_FORBIDDEN')}});
const {TaskDialog}=require('../src/components/task-dialog') as typeof import('../src/components/task-dialog');
const task={id:'task',title:'QA task',type:'Производство',status:'NEW',dueAt:null,assigneeId:null,assigneeName:null,requiresPhoto:false,workId:'work',workTitle:'QA work',workTotal:'100',workPriceSnapshot:'100',quantity:'1',dependencies:[],projectId:'project',projectNumber:'QA',projectTitle:'QA project',productId:'product',productNumber:'QA.1',productTitle:'QA product',files:[{id:'file',fileName:'Original.pdf',mimeType:'application/pdf',canDelete:true}],createdAt:'2026-10-01T00:00:00Z',doneAt:null,doneByName:null,createdByName:null} as TaskDetails;
function nodes(node:React.ReactNode):React.ReactElement[]{if(Array.isArray(node))return node.flatMap(nodes);if(!React.isValidElement(node))return[];return[node,...nodes((node.props as {children?:React.ReactNode}).children)];}
function render(){cursor=0;const tree=TaskDialog({task,workers:[],canEdit:true,open:true,onOpenChange:()=>{closed++;}});return nodes(tree);}
function list(tree:React.ReactElement[]){return tree.find(node=>node.type==='file-list')?.props as Parameters<typeof FileList>[0]|undefined;}
function root(tree:React.ReactElement[]){return tree.find(node=>node.type==='dialog-root')?.props as {onOpenChange:(next:boolean)=>void};}
function reset(){states.length=0;refreshes=0;closed=0;deleteOk=true;}

test('confirmed task file deletion removes the cached selected row without mutating task props and refreshes once',()=>{
 reset();const before=structuredClone(task),files=list(render());assert.ok(files?.onDeleted);files.onDeleted(task.files[0]);assert.equal(list(render()),undefined);assert.equal(refreshes,1);assert.deepEqual(task,before);
});

test('failed task file deletion preserves the selected filename and sends no task or finance mutation',async()=>{
 reset();deleteOk=false;const files=list(render());assert.ok(files?.onDelete);const result=await files.onDelete(task.files[0],'00000000-0000-4000-8000-000000000137');assert.equal(result.ok,false);assert.equal(list(render())?.files[0].fileName,'Original.pdf');assert.equal(refreshes,0);
});

test('file pending prevents dialog close immediately and releases it after completion',()=>{
 reset();const tree=render(),files=list(tree);assert.ok(files?.onBusyChange);files.onBusyChange(true);root(tree).onOpenChange(false);assert.equal(closed,0);files.onBusyChange(false);root(render()).onOpenChange(false);assert.equal(closed,1);
});
