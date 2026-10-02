// Build only. Root executes the resulting ESM CLI separately.
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const directory=path.dirname(fileURLToPath(import.meta.url));
const web=path.resolve(directory,'../..');
const output=path.join(web,'test-results','byn-price-coordinator.bundle.mjs');
await mkdir(path.dirname(output),{recursive:true});
await build({entryPoints:[path.join(directory,'coordinator.ts')],outfile:output,bundle:true,platform:'node',format:'esm',target:'node22',external:['@prisma/client'],minify:true,logLevel:'silent',tsconfig:path.join(web,'tsconfig.json')});
const bytes=await readFile(output);
console.log(JSON.stringify({status:'BUILT',output,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),dbExecuted:false}));
