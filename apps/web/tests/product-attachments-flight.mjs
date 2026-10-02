// Только observer для трёх source-reviewed existing actions с законным full RSC; браузер получает исходные bytes.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const require=createRequire(import.meta.url);
const fail=code=>{throw Error(code)};
export function attachmentActionScope({scope,fixture,actorId,path,actionId,args}){
 if(!['file-delete','no-model','cover-bind'].includes(scope)||!/^[a-f0-9]{40,64}$/i.test(actionId??'')||!Object.values(fixture.actors).some(row=>row.id===actorId)||![fixture.paths.productA,fixture.paths.productB].includes(path)||fixture.actionIds?.[scope]!==actionId)fail('ATTACHMENT_ACTION_BINDING_STOP');
 const pathProductId=path===fixture.paths.productA?fixture.ids.productA:fixture.ids.productB;
 if(scope==='file-delete'){if(!Array.isArray(args)||args.length!==1||typeof args[0]!=='string'||!fixture.allowedFileIds?.includes(args[0])||fixture.fileSubjects?.[args[0]]!==pathProductId)fail('ATTACHMENT_DELETE_SCOPE_STOP');}
 else if(scope==='cover-bind'){if(actorId!==fixture.actors.admin.id||pathProductId!==fixture.ids.productB||!Array.isArray(args)||args.length!==2||args[0]!==pathProductId||!fixture.allowedFileIds?.includes(args[1])||fixture.fileSubjects?.[args[1]]!==pathProductId)fail('ATTACHMENT_COVER_BIND_SCOPE_STOP');}
 else{const input=Array.isArray(args)&&args.length===1?args[0]:null;if(!input||typeof input!=='object'||Object.keys(input).sort().join('|')!=='noModel|productId'||input.productId!==pathProductId||typeof input.noModel!=='boolean')fail('ATTACHMENT_NOMODEL_SCOPE_STOP');}
 return scope;
}
export async function decodeAttachmentAction({body,status,headers,...binding}){
 const scope=attachmentActionScope(binding);if(require('next/package.json').version!=='15.5.20')fail('ATTACHMENT_FLIGHT_VERSION_STOP');const bytes=Buffer.from(body),metadata=new Headers(headers);if(status!==200||bytes.length>2*1024*1024||!metadata.get('content-type')?.startsWith('text/x-component')||metadata.has('x-action-redirect')||metadata.get('x-nextjs-action-not-found')==='1')fail('ATTACHMENT_FLIGHT_BOUNDARY_STOP');
 // Новый isolated VM на каждый ответ. SSR references получают инертный namespace,
 // ни один app module/chunk/callServer не загружается и не исполняется.
 let inertFunctionCalls=0;const inert=()=>{inertFunctionCalls++;fail('ATTACHMENT_OBSERVER_FUNCTION_EXECUTION_STOP')},inertExports=new Proxy(Object.create(null),{get(_target,key){if(key==='then')return undefined;if(key==='__esModule')return true;return inert},getOwnPropertyDescriptor(){return{value:inert,writable:false,enumerable:true,configurable:true}}});
 const info={id:'qa-observer-inert',chunks:[],name:'*',async:false};const exportsMap=new Proxy(Object.create(null),{get(){return info}});const moduleMap=new Proxy(Object.create(null),{get(){return exportsMap}}),serverMap=new Proxy(Object.create(null),{get(){return{...info,name:'default'}}});
 const qaModule={exports:{}};let loads=0;
 const sandbox={module:qaModule,exports:qaModule.exports,require:name=>{if(!['react','react-dom'].includes(name))fail('ATTACHMENT_OBSERVER_REQUIRE_STOP');return require(name)},process:{env:{NODE_ENV:'production'}},TextDecoder,TextEncoder,ReadableStream,Response,Headers,FormData,Blob,AbortController,performance,URL,setTimeout,clearTimeout,queueMicrotask,console:{log(){},warn(){},error(){}},__webpack_chunk_load__:()=>fail('ATTACHMENT_OBSERVER_CHUNK_LOAD_STOP'),__next_require__:id=>{if(id!=='qa-observer-inert')fail('ATTACHMENT_OBSERVER_APP_MODULE_STOP');loads++;return inertExports}};
 const edge=require.resolve('next/dist/compiled/react-server-dom-webpack/client.edge');const source=readFileSync(new URL('./cjs/react-server-dom-webpack-client.edge.production.js',`file:///${edge.replaceAll('\\','/')}`),'utf8');
 runInNewContext(source,sandbox,{filename:'installed-next15.5.20-qa-inert-edge.js',timeout:1000});
 const envelope=await qaModule.exports.createFromFetch(Promise.resolve(new Response(bytes,{status,headers:metadata})),{serverConsumerManifest:{moduleMap,serverModuleMap:serverMap,moduleLoading:null},replayConsoleLogs:false});
 if(!envelope||typeof envelope!=='object'||!envelope.a||typeof envelope.a.then!=='function'||Object.keys(envelope).some(key=>!['a','f','b'].includes(key)))fail('ATTACHMENT_ACTION_PROMISE_REQUIRED');
 let timer;let result;try{result=await Promise.race([envelope.a,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ATTACHMENT_FLIGHT_TIMEOUT_STOP')),10000)})])}finally{clearTimeout(timer)}
 if(!result||typeof result!=='object'||Array.isArray(result)||typeof result.ok!=='boolean'||Object.keys(result).some(key=>!(scope==='no-model'?['ok','error','result']:['ok','error']).includes(key))||(result.error!==undefined&&typeof result.error!=='string')||(result.result!==undefined&&result.result!==null))fail('ATTACHMENT_ACTION_RESULT_SHAPE_STOP');
 return{ok:result.ok,...(result.error!==undefined?{error:result.error}:{}),observer:{codec:'installed Next15.5.20 client.edge isolatedVM',fullRscDiscarded:true,inertNamespaceLookups:loads,inertFunctionCalls,appModulesExecuted:0}};
}
