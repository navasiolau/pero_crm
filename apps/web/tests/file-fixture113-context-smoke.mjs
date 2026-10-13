// Frozen adapter для действующих task115 и readonly finance callers.
// SAFETY D:/Projects/pero_infra/infra-recovery/SAFETY-RULES.md: STOP при mismatch.
import {createHash} from 'node:crypto';
import {need} from './file-fixture113-protocol.mjs';
export const FROZEN_SOURCES=Object.freeze({
 'file-fixture113-entry.mjs':'def45eb010e03daaa6526ac8862c1c752e91c135b022cabcb2fd8bc54f1501fb',
 'file-fixture113-protocol.mjs':'7b1001d102408facba349ce3db4279421dc29d87ade4fb1e6c795751d706fe92',
 'crm-acceptance-token-clock.mjs':'13407f3f719ef7962e2ffb21abb52089e7132b4ec402db87340d9c2fe3b7fc51',
});
export const FROZEN_EXTRA=Object.freeze({
 'file-fixture113-runner.mjs':'b6dd281a1985b841843e4483241fb07dbd33f88cfdf5cdf0996d827823d875fe',
 'file-fixture113-lifecycle-native.mjs':'60105e21a10a856343562aa1e4e12bf4ef33ce6e1872c6573064d9b2252862f0',
});
export const ADAPTER_AUTORUN="const entry=process.argv[1];if((!entry||path.resolve(entry)===fileURLToPath(import.meta.url))&&process.env.CRM_STAGING_BROWSER_INPUT&&process.env.CRM_MODERNIZATION_TARGET==='staging')void main();";
export const ADAPTER_EXPORTS=Object.freeze(['original','storage','readonly','cookies','preGuard','protectedWriteRows','selected','client']);
export const bytesHash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function derivedFrozenLibrary(bytes){
 need(bytes instanceof Uint8Array&&bytesHash(bytes)===FROZEN_SOURCES['file-fixture113-entry.mjs'],'FROZEN_ENTRY_BYTES_CHANGED');
 const text=Buffer.from(bytes).toString('utf8'),matches=text.split(ADAPTER_AUTORUN);
 need(matches.length===2&&/^\r?\n?$/.test(matches[1]),'EXACT_ONE_FINAL_AUTORUN_REQUIRED');
 return matches[0]+'\nexport {'+ADAPTER_EXPORTS.join(',')+'};\n';
}
