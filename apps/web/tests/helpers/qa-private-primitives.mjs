// Общие операции QA; политики остаются у семейства.
// SAFETY: D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md; STOP при mismatch.
import {createHash} from 'node:crypto';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function canonical(value){return Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);}
// Прежние source-manifest hashes сохраняют точные bytes и canonical ordering.
export const evidenceHash=sha;
export const declarationHash=value=>evidenceHash(canonical(value));
