import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {inspectNativeFilePrintPreview} from './helpers/native-file-print-preview.mjs';

function fixture({preexisting = false, error = '0', isPdf = true, cancelFound = true} = {}) {
 const cdp = new EventEmitter(), commands = [];let open = preexisting, triggers = 0;
 cdp.detach = async () => {};
 cdp.send = async (method, params) => {
  commands.push({method, params});
  if (method === 'Target.getTargets') return {targetInfos: open ? [{targetId:'owned-preview',url:'chrome://print/'}] : []};
  if (method === 'Target.attachToTarget') return {sessionId:'owned-session'};
  if (method === 'Target.closeTarget') {open = false;return {};}
  if (method === 'Target.sendMessageToTarget') {
   const message = JSON.parse(params.message);let result = {};
   if (message.method === 'Runtime.evaluate') {
    const cancel = message.params.expression.includes('function find(root)');
    if (cancel && cancelFound) open = false;
    result = {result:{value: cancel ? cancelFound : {state:'1',pageCount:'1',isPdf,error,previewLoaded:true}}};
   } else if (message.method === 'Page.captureScreenshot') result = {data:Buffer.from('synthetic-png-proof').toString('base64')};
   queueMicrotask(() => cdp.emit('Target.receivedMessageFromTarget',{sessionId:'owned-session',message:JSON.stringify({id:message.id,result})}));return {};
  }
  return {};
 };
 return {cdp, commands, browser:{newBrowserCDPSession:async()=>cdp}, trigger:async()=>{triggers++;open=true;}, isOpen:()=>open, triggers:()=>triggers};
}

test('native protocol verifies real-preview shape and cancels, with no print-submit action', async () => {
 const f = fixture(), captures = [];
 const result = await inspectNativeFilePrintPreview({...f,isPdf:true,settleMs:0,saveScreenshot:async bytes=>captures.push(bytes.toString())});
 assert.equal(result.kind,'actual-native-preview');assert.equal(result.canceled,true);assert.equal(result.physicalPrintSubmitted,false);
 assert.deepEqual(captures,['synthetic-png-proof']);assert.equal(f.isOpen(),false);assert.equal(f.triggers(),1);
 const expressions = f.commands.filter(command=>command.method==='Target.sendMessageToTarget').map(command=>JSON.parse(command.params.message).params.expression??'');
 assert.ok(expressions.some(expression=>expression.includes('Cancel|Отмена')));assert.ok(expressions.every(expression=>!expression.includes("name:'Печать'")&&!expression.includes('window.print')));
 assert.equal(f.cdp.listenerCount('Target.receivedMessageFromTarget'),0);
});
test('a pre-existing dialog rejects before selected-file trigger', async () => {
 const f=fixture({preexisting:true});await assert.rejects(inspectNativeFilePrintPreview({...f,isPdf:true,settleMs:0}),/F116_NATIVE_PREEXISTING_DIALOG/);assert.equal(f.triggers(),0);
});
test('error/native wrong kind rejects but the dialog is still canceled', async () => {
 for(const flags of [{error:'1'},{isPdf:false}]){const f=fixture(flags);await assert.rejects(inspectNativeFilePrintPreview({...f,isPdf:true,settleMs:0}),/F116_NATIVE_PREVIEW_INVALID/);assert.equal(f.isOpen(),false);}
});
test('missing cancel cannot produce PASS; fallback closes only the native target', async () => {
 const f=fixture({cancelFound:false});await assert.rejects(inspectNativeFilePrintPreview({...f,isPdf:true,settleMs:0}),/F116_NATIVE_CANCEL_MISSING/);assert.equal(f.isOpen(),false);assert.ok(f.commands.some(command=>command.method==='Target.closeTarget'));
});

test('CDP transport rejection is bounded and cannot leave an unhandled pending reply', async () => {
 const f=fixture(),send=f.cdp.send;f.cdp.send=async(method,params)=>{if(method==='Target.sendMessageToTarget')throw Error('synthetic transport error');return send(method,params);};
 await assert.rejects(inspectNativeFilePrintPreview({...f,isPdf:true,settleMs:0,timeoutMs:100}),/F116_NATIVE_CDP_FAILED/);assert.equal(f.isOpen(),false);assert.equal(f.cdp.listenerCount('Target.receivedMessageFromTarget'),0);
});
