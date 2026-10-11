// Private technical wire for fresh task111 QA. No runtime/DB/HTTP work on import.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP on guard mismatch.
import {canonical as technicalCanonical,sha} from './helpers/qa-private-primitives.mjs';
export {technicalCanonical};
import {gzipSync,gunzipSync} from 'node:zlib';
export const INPUT_WIRE_LIMIT=64*1024,OUTPUT_WIRE_LIMIT=192*1024,DECODED_LIMIT=2*1024*1024;
const HASH=/^[a-f0-9]{64}$/,B64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const need=(value,code)=>{if(!value)throw Error(code);};
const forbiddenKeys=new Set(['cookies','cookie','password','passwordHash','authSecret','AUTH_SECRET','NEXTAUTH_SECRET','secret','authorization','Authorization','basicAuth','token','sessionToken','profile','email','phone','address']);
export function assertTechnicalPersistence(value){
 let count=0;
 function visit(item,depth){
  need(depth<=48&&++count<=100000,'DRAFT111_TECHNICAL_VALUE_BOUNDED');
  if(item===null)return;
  if(typeof item==='number'){need(Number.isFinite(item),'DRAFT111_TECHNICAL_NUMBER_REQUIRED');return;}
  if(typeof item==='boolean')return;
  if(typeof item==='string'){
   need(!/(?:Bearer\s+|(?:^|\n)(?:Authorization|Cookie|Set-Cookie)\s*:)/i.test(item),'DRAFT111_PRIVATE_SECRET_PERSISTENCE_FORBIDDEN');
   need(!/^(?:[A-Za-z0-9_-]{12,}\.){2}[A-Za-z0-9_-]{12,}$/.test(item)&&!(/^[A-Za-z0-9_.-]+$/.test(item)&&item.split('.').length===5&&item.length>80),'DRAFT111_PRIVATE_JWT_PERSISTENCE_FORBIDDEN');
   if((item.startsWith('{')||item.startsWith('['))&&item.length<=DECODED_LIMIT){let parsed;try{parsed=JSON.parse(item);}catch{}if(parsed!==undefined)visit(parsed,depth+1);}
   return;
  }
  need(typeof item==='object'&&(Array.isArray(item)||Object.getPrototypeOf(item)===Object.prototype),'DRAFT111_TECHNICAL_PLAIN_VALUE_REQUIRED');
  for(const [key,child] of Object.entries(item)){need(!forbiddenKeys.has(key),'DRAFT111_PRIVATE_SECRET_PERSISTENCE_FORBIDDEN');if(key==='passwordDisabled')need(typeof child==='boolean','DRAFT111_PRIVATE_SECRET_PERSISTENCE_FORBIDDEN');visit(child,depth+1);}
 }
 need(value&&typeof value==='object'&&!Array.isArray(value),'DRAFT111_TECHNICAL_RECORD_REQUIRED');visit(value,0);return value;
}
function limitOption(value){need(value===INPUT_WIRE_LIMIT||value===OUTPUT_WIRE_LIMIT,'DRAFT111_FIXED_WIRE_LIMIT_REQUIRED');return value;}
export function encodeFunctionalWire(value,{maxWireBytes=INPUT_WIRE_LIMIT}={}){
 limitOption(maxWireBytes);assertTechnicalPersistence(value);
 const bytes=Buffer.from(technicalCanonical(value));need(bytes.length>0&&bytes.length<=DECODED_LIMIT,'DRAFT111_DECODED_LIMIT');
 const wire={kind:'product-draft-stage-wire',version:1,encoding:'gzip-base64',decodedBytes:bytes.length,decodedSha256:sha(bytes),data:gzipSync(bytes,{level:9}).toString('base64')};
 need(Buffer.byteLength(JSON.stringify(wire))<=maxWireBytes,'DRAFT111_COMPRESSED_WIRE_LIMIT');return wire;
}
export function decodeFunctionalWire(wire,{maxWireBytes=INPUT_WIRE_LIMIT}={}){
 limitOption(maxWireBytes);
 need(wire&&typeof wire==='object'&&!Array.isArray(wire)&&technicalCanonical(Object.keys(wire).sort())===technicalCanonical(['kind','version','encoding','decodedBytes','decodedSha256','data'].sort()),'DRAFT111_WIRE_FIELDS_REQUIRED');
 need(wire.kind==='product-draft-stage-wire'&&wire.version===1&&wire.encoding==='gzip-base64'&&Number.isSafeInteger(wire.decodedBytes)&&wire.decodedBytes>0&&wire.decodedBytes<=DECODED_LIMIT&&HASH.test(wire.decodedSha256??'')&&typeof wire.data==='string','DRAFT111_WIRE_SCHEMA_REQUIRED');
 need(Buffer.byteLength(JSON.stringify(wire))<=maxWireBytes&&B64.test(wire.data)&&Buffer.from(wire.data,'base64').toString('base64')===wire.data,'DRAFT111_WIRE_CANONICAL_BASE64_LIMIT');
 let bytes;try{bytes=gunzipSync(Buffer.from(wire.data,'base64'),{maxOutputLength:DECODED_LIMIT});}catch{throw Error('DRAFT111_WIRE_GZIP_INVALID');}
 need(bytes.length===wire.decodedBytes&&sha(bytes)===wire.decodedSha256,'DRAFT111_WIRE_DIGEST_LENGTH_MISMATCH');
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('DRAFT111_WIRE_JSON_INVALID');}
 assertTechnicalPersistence(value);need(Buffer.from(technicalCanonical(value)).equals(bytes),'DRAFT111_WIRE_NONCANONICAL_JSON');return value;
}

const PHASE_OPERATIONS={plan:'inspect',prepare:'prepare',capture:'inspect',cleanup:'restore',handoff:'inspect'};
const INPUT_PAYLOAD_KEYS=new Set(['pre','checkpoint','observation','journal','durablePre','noHookPolicy']);
export function packFunctionalInput({operation,phase,revision,runId,authorized},payload={}){
 const outer={operation,phase,revision,runId,authorized,wire:encodeFunctionalWire(payload)};
 unpackFunctionalInput(outer);return outer;
}
export function unpackFunctionalInput(outer){
 need(outer&&technicalCanonical(Object.keys(outer).sort())===technicalCanonical(['operation','phase','revision','runId','authorized','wire'].sort()),'DRAFT111_OUTER_INPUT_FIELDS_REQUIRED');
 need(outer.authorized===true&&/^[a-f0-9]{40}$/.test(outer.revision??'')&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(outer.runId??'')&&PHASE_OPERATIONS[outer.phase]===outer.operation,'DRAFT111_EXACT_PHASE_OPERATION_BINDING');
 const payload=decodeFunctionalWire(outer.wire);need(Object.keys(payload).every(key=>INPUT_PAYLOAD_KEYS.has(key)),'DRAFT111_PAYLOAD_FIELDS_REQUIRED');
 const input={operation:outer.operation,phase:outer.phase,revision:outer.revision,runId:outer.runId,authorized:true,...payload};
 for(const field of ['pre','checkpoint','observation'])if(input[field])need(input[field].revision===outer.revision&&input[field].runId===outer.runId&&/^[a-f0-9]{64}$/.test(input[field].signature??''),'DRAFT111_SIGNED_PROOF_BINDING');
 if(input.journal)need(input.journal.revision===outer.revision&&input.journal.runId===outer.runId,'DRAFT111_JOURNAL_BINDING');
 return input;
}
