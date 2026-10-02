// Только QA: изменённый React asset не является доказательством staging-приёмки.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const SEAM='function rD(e){var n=Error(i(418,';
const ANNOTATION=`function rD(e){try{var qa19Attrs=function(p){return{className:p&&typeof p.className==="string"?p.className.slice(0,1500):null,slot:p&&typeof p["data-slot"]==="string"&&/^[a-z0-9-]{1,80}$/i.test(p["data-slot"])?p["data-slot"]:null,role:p&&typeof p.role==="string"&&/^[a-z-]{1,40}$/i.test(p.role)?p.role:null}},qa19Label=function(f){var t=f&&f.type;return Object.assign({tag:f&&f.tag,type:typeof t==="string"?t:typeof t==="function"?(t.displayName||t.name||"anonymous"):typeof t,id:f&&f.pendingProps&&typeof f.pendingProps.id==="string"&&/^product-/.test(f.pendingProps.id)?f.pendingProps.id:null},qa19Attrs(f&&f.pendingProps))},qa19Path=[],qa19Parent=e,qa19Cursor=typeof rN==="undefined"?null:rN;for(var qa19Index=0;qa19Parent&&qa19Index<24;qa19Index++,qa19Parent=qa19Parent.return)qa19Path.push(qa19Label(qa19Parent));var qa19Rows=globalThis.__qa19HydrationMismatches;if(!Array.isArray(qa19Rows))qa19Rows=globalThis.__qa19HydrationMismatches=[];if(qa19Rows.length<32)qa19Rows.push({kind:"instrumented-react418-diagnostic-not-acceptance",at:Date.now(),host:qa19Label(e),ancestors:qa19Path,nextHydratable:qa19Cursor?{nodeType:qa19Cursor.nodeType,nodeName:qa19Cursor.nodeName,id:typeof qa19Cursor.id==="string"&&/^product-/.test(qa19Cursor.id)?qa19Cursor.id:null,attributes:qa19Attrs({className:typeof qa19Cursor.getAttribute==="function"?qa19Cursor.getAttribute("class"):null,"data-slot":typeof qa19Cursor.getAttribute==="function"?qa19Cursor.getAttribute("data-slot"):null,role:typeof qa19Cursor.getAttribute==="function"?qa19Cursor.getAttribute("role"):null})}:null})}catch(qa19DiagnosticError){}var n=Error(i(418,`;
export function instrumentDescriptionHydrationAsset({source,expectedSha256,nextVersion,enabled=false}){
 assert.equal(enabled,true,'QA19_DIAGNOSTIC_EXPLICIT_ENABLE_REQUIRED');
 assert.equal(nextVersion,'15.5.20','QA19_PINNED_NEXT_REQUIRED');
 assert.equal(typeof source,'string','QA19_ASSET_SOURCE_REQUIRED');
 assert.match(expectedSha256??'',/^[a-f0-9]{64}$/,'QA19_ASSET_SHA_REQUIRED');
 const originalSha256=createHash('sha256').update(source).digest('hex');
 assert.equal(originalSha256,expectedSha256,'QA19_ASSET_SHA_MISMATCH_STOP');
 assert.equal(source.split(SEAM).length-1,1,'QA19_EXACT_ONE_REACT418_SEAM_REQUIRED');
 assert.ok(/\brN\s*=/.test(source),'QA19_PINNED_HYDRATION_CURSOR_REQUIRED');
 const instrumented=source.replace(SEAM,ANNOTATION);
 return{source:instrumented,metadata:{kind:'instrumented-react418-diagnostic-not-acceptance',nextVersion,originalSha256,instrumentedSha256:createHash('sha256').update(instrumented).digest('hex'),seamCount:1,normalAcceptance:false}};
}
