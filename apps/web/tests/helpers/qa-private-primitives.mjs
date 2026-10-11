// Общие операции QA; политики остаются у семейства.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при mismatch.
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import path from 'node:path';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function canonical(value){return Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);}
export function checkAncestors(current,stop,includeStop,reparseCode,ancestorCode,compare=value=>value){
 while(true){
  const atStop=stop!==null&&compare(current)===compare(stop);
  if(atStop&&!includeStop)return;
  if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error(reparseCode);
  if(atStop)return;
  const parent=path.dirname(current);
  if(parent===current){if(stop!==null)throw Error(ancestorCode);return;}
  current=parent;
 }
}
export function durableWrite(file,bytes,flags='wx'){
 const fd=openSync(file,flags,0o600);
 try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
}
