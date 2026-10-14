// Закрытый технический канал QA110: никакой сессии или секрета в файлах.
import {canonical,sha} from './helpers/qa-private-primitives.mjs';
export {canonical,sha};
const DECODED_LIMIT=2*1024*1024;
export const need=(ok,code)=>{if(!ok)throw Error(code);};
export const digest=value=>sha(canonical(value));
const PRIVATE_KEYS=/^(?:cookies?|password|passwordHash|AUTH_SECRET|secret|authorization|token|sessionToken|profiles?|email|phone|address|basicAuth|headers)$/i;
const SECRET_STRING=/(?:^|\s)(?:Cookie|Authorization|Bearer)\s*[: ]|(?:^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_.-]{16,}(?:$|[^A-Za-z0-9_-])/i;
export function assertTechnical(value){let items=0;function walk(item,depth){need(depth<=64&&++items<=100000,'TECHNICAL_COMPLEXITY_LIMIT');if(item===null||typeof item==='boolean')return;if(typeof item==='number'){need(Number.isFinite(item),'TECHNICAL_FINITE_NUMBER_REQUIRED');return;}if(typeof item==='string'){need(Buffer.byteLength(item)<=DECODED_LIMIT&&!SECRET_STRING.test(item),'PRIVATE_VALUE_FORBIDDEN');if(/^[\[{]/.test(item.trim())){let embedded;try{embedded=JSON.parse(item);}catch{return;}walk(embedded,depth+1);}return;}need(typeof item==='object'&&Object.getPrototypeOf(item)!==Date.prototype,'TECHNICAL_JSON_ONLY');if(Array.isArray(item)){for(const child of item)walk(child,depth+1);return;}need(Object.getPrototypeOf(item)===Object.prototype||Object.getPrototypeOf(item)===null,'TECHNICAL_PLAIN_OBJECT_REQUIRED');for(const[key,child]of Object.entries(item)){need(!PRIVATE_KEYS.test(key),'PRIVATE_KEY_FORBIDDEN');if(key==='passwordDisabled')need(typeof child==='boolean','PASSWORD_FLAG_ONLY');walk(child,depth+1);}}walk(value,0);return value;}
