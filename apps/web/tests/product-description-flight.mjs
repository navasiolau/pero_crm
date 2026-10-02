// Реальный pinned React Flight decoder. Модули, полная карточка и redirects здесь запрещены.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const NEXT_VERSION='15.5.20';
const fail=code=>{throw Error(code)};
const plain=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype);
export async function decodeProductDescriptionAction({body,status,headers,patch}){
 if(require('next/package.json').version!==NEXT_VERSION)fail('DESCRIPTION_FLIGHT_NEXT_VERSION_MISMATCH');
 const bytes=Buffer.from(body);if(bytes.length>=24000||status!==200)fail('DESCRIPTION_FLIGHT_RESPONSE_BOUNDARY');
 const metadata=new Headers(headers);if(!metadata.get('content-type')?.startsWith('text/x-component'))fail('DESCRIPTION_FLIGHT_CONTENT_TYPE_REQUIRED');
 if(metadata.has('x-action-redirect')||metadata.get('x-nextjs-action-not-found')==='1')fail('DESCRIPTION_FLIGHT_REDIRECT_OR_UNKNOWN_ACTION');
 let revalidated;try{revalidated=JSON.parse(metadata.get('x-action-revalidated')??'[[],0,0]')}catch{fail('DESCRIPTION_FLIGHT_REVALIDATION_METADATA_INVALID')}
 if(!Array.isArray(revalidated)||!Array.isArray(revalidated[0])||revalidated[0].length||revalidated[1])fail('DESCRIPTION_FLIGHT_REVALIDATION_FORBIDDEN');
 let blockedModule=false;
 const denyModules=new Proxy(Object.create(null),{get(){blockedModule=true;fail('DESCRIPTION_FLIGHT_MODULE_REFERENCE_FORBIDDEN')}});
 const {createFromFetch}=require('next/dist/compiled/react-server-dom-webpack/client.edge');
 let envelope,result;let timer;
 try{
  const decoded=(async()=>{
   envelope=await createFromFetch(Promise.resolve(new Response(bytes,{status,headers:metadata})),{serverConsumerManifest:{moduleMap:denyModules,serverModuleMap:denyModules,moduleLoading:null},replayConsoleLogs:false});
   if(!plain(envelope)||(envelope.b!==undefined&&typeof envelope.b!=='string')||Object.keys(envelope).some(key=>!['a','f','b'].includes(key))||!envelope.a||typeof envelope.a.then!=='function')fail('DESCRIPTION_FLIGHT_ACTION_ENVELOPE_REQUIRED');
   if(envelope.f!==undefined&&envelope.f!==null&&envelope.f!==''&&!(Array.isArray(envelope.f)&&envelope.f.length===0))fail('DESCRIPTION_FLIGHT_FULL_RSC_FORBIDDEN');
   return await envelope.a;
  })();
  result=await Promise.race([decoded,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DESCRIPTION_FLIGHT_DECODE_TIMEOUT')),10000)})]);
 }catch(error){if(blockedModule)fail('DESCRIPTION_FLIGHT_MODULE_REFERENCE_FORBIDDEN');throw error}finally{clearTimeout(timer)}
 if(blockedModule)fail('DESCRIPTION_FLIGHT_MODULE_REFERENCE_FORBIDDEN');
 if(!plain(result)||result.field!=='description'||result.clientMutationId!==patch.clientMutationId)fail('DESCRIPTION_FLIGHT_OWNED_RESULT_METADATA_MISMATCH');
 if(!['saved','validation','conflict','forbidden','not-found','failure'].includes(result.kind))fail('DESCRIPTION_FLIGHT_RESULT_KIND_INVALID');
 const keys=result.kind==='saved'?['kind','field','clientMutationId','value','derived','repeated','noOp']:['kind','field','clientMutationId','error','currentValue'];
 if(Object.keys(result).some(key=>!keys.includes(key)))fail('DESCRIPTION_FLIGHT_RESULT_NOT_COMPACT');
 if(result.kind==='saved'){
  if(result.value!==null&&typeof result.value!=='string')fail('DESCRIPTION_FLIGHT_DESCRIPTION_VALUE_INVALID');
  if(result.derived!==undefined&&(!plain(result.derived)||Object.keys(result.derived).length))fail('DESCRIPTION_FLIGHT_UNRELATED_DERIVED_FORBIDDEN');
  for(const key of ['noOp','repeated'])if(result[key]!==undefined&&typeof result[key]!=='boolean')fail('DESCRIPTION_FLIGHT_SAVED_FLAGS_INVALID');
 }else{
  if(typeof result.error!=='string'||(result.currentValue!==undefined&&result.currentValue!==null&&typeof result.currentValue!=='string'))fail('DESCRIPTION_FLIGHT_ERROR_RESULT_INVALID');
 }
 return result;
}
