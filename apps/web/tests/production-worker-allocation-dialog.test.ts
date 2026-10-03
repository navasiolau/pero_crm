import assert from 'node:assert/strict';
import {before,test} from 'node:test';
import React from 'react';
import {createRequire,Module} from 'node:module';
const require=createRequire(import.meta.url);
function inject(name:string,exports:Record<string,unknown>){const file=require.resolve(name),stub=new Module(file);stub.filename=file;stub.loaded=true;stub.exports=exports;require.cache[file]=stub;}
let render:()=>React.ReactElement,finish:Promise<void>|undefined;let closes=0,refreshes=0;
const calls:unknown[]=[],states:unknown[]=[],refs:{current:unknown}[]=[];let stateIndex=0,refIndex=0;
const host=(tag:string)=>{function Host(props:Record<string,unknown>){return React.createElement(tag,props);}return Host;};
before(()=>{
 (globalThis as unknown as {React:typeof React}).React=React;
 inject('react',{...React,useState:(initial:unknown)=>{const i=stateIndex++;if(!(i in states))states[i]=typeof initial==='function'?(initial as ()=>unknown)():initial;return[states[i],(value:unknown)=>{states[i]=typeof value==='function'?(value as (old:unknown)=>unknown)(states[i]):value;}];},useRef:(value:unknown)=>{const i=refIndex++;return refs[i]??(refs[i]={current:value});},useTransition:()=>[false,(callback:()=>Promise<void>)=>{finish=callback();}]});
 inject('next/navigation',{useRouter:()=>({refresh(){refreshes++;}})});inject('sonner',{toast:{success(){}}});
 inject('../src/components/ui/button',{Button:host('button')});inject('../src/components/ui/input',{Input:host('input')});inject('../src/components/ui/label',{Label:host('label')});inject('../src/components/ui/searchable-select',{SearchableSelect:host('select')});inject('../src/components/quantity-stepper',{QuantityStepper:host('input')});inject('../src/components/task-dialog',{TASK_TYPES:['Производство']});
 inject('../src/components/ui/dialog',Object.fromEntries(['Dialog','DialogContent','DialogFooter','DialogHeader','DialogTitle'].map(name=>[name,host('section')])));
 inject('../src/server/tasks/worker-allocation-actions',{createWorkerWorkTask:async(payload:unknown)=>{calls.push(payload);if(calls.length===1)throw Error('LOST_ACK');if(calls.length===2)return{ok:false,kind:'validation',error:'Проверьте оценку'};return{ok:true,id:'task'};}});
 const {WorkerTaskAllocationDialog}=require('../src/components/worker-task-allocation-dialog') as typeof import('../src/components/worker-task-allocation-dialog');
 render=()=>{stateIndex=refIndex=0;return WorkerTaskAllocationDialog({projectId:'j',productId:'p',actorUserId:'me',work:{id:'w',title:'Cut',remaining:'0.30'},data:{workerOptions:[{id:'me',name:'Me'}],createdAssignments:[],dependencyOptions:[],eligibleWorkIds:['w']},onClose(){closes++;}});};
});
function elements(value:unknown):React.ReactElement<Record<string,unknown>>[]{if(Array.isArray(value))return value.flatMap(elements);if(!React.isValidElement(value))return[];const node=value as React.ReactElement<Record<string,unknown>>;return[node,...elements(node.props.children)];}
function button(tree:React.ReactElement,label:string){const node=elements(tree).find(node=>node.props.children===label&&typeof node.props.onClick==='function');assert.ok(node);return node.props;}
test('actual dialog locks unknown response, retries identical request explicitly, then releases only after definite validation',async()=>{
 let tree=render();(button(tree,'Назначить').onClick as ()=>void)();await finish;assert.equal(calls.length,1);assert.equal(closes,0);tree=render();assert.ok(elements(tree).some(node=>node.type==='fieldset'&&node.props.disabled===true));(tree.props as {onOpenChange:(open:boolean)=>void}).onOpenChange(false);assert.equal(closes,0);assert.equal(button(tree,'Отмена').disabled,true);
 (button(tree,'Повторить тот же запрос').onClick as ()=>void)();await finish;assert.equal(calls.length,2);assert.strictEqual(calls[0],calls[1]);tree=render();assert.ok(elements(tree).some(node=>node.type==='fieldset'&&node.props.disabled===false));const title=elements(tree).find(node=>node.props.id==='worker-task-title');assert.ok(title);assert.equal(title.props.readOnly,true);assert.equal(title.props.onChange,undefined);const quantity=elements(tree).find(node=>node.props.remaining==='0.30'&&typeof node.props.onChange==='function');assert.ok(quantity);(quantity.props.onChange as (value:string)=>void)('0.20');tree=render();(button(tree,'Назначить').onClick as ()=>void)();await finish;assert.equal(calls.length,3);assert.notEqual((calls[2] as {clientMutationId:string}).clientMutationId,(calls[0] as {clientMutationId:string}).clientMutationId);assert.equal((calls[2] as {title:string;quantity:string}).title,'Cut');assert.equal((calls[2] as {quantity:string}).quantity,'0.20');assert.equal(closes,1);assert.equal(refreshes,1);
});
