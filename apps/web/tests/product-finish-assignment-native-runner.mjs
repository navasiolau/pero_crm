import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,relative,isAbsolute} from 'node:path';
import {readFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const web=resolve(dirname(fileURLToPath(import.meta.url)),'..'),out=resolve(process.argv[2]??'');
const allowed=relative(resolve(web,'test-results'),out);if(!process.argv[2]||!allowed||allowed.startsWith('..')||isAbsolute(allowed)||!out.endsWith('.bundle.mjs'))throw Error('NATIVE_OUTPUT_SCOPE_REQUIRED');
mkdirSync(dirname(out),{recursive:true});
const proxy=`export const prisma=new Proxy({}, {get(_target,key){const tx=globalThis.__productFinishNativeTx;if(!tx)throw Error('NATIVE_OUTER_TRANSACTION_REQUIRED');if(key==='$transaction')return async fn=>globalThis.__productFinishNativeBoundary(fn);const value=tx[key];return typeof value==='function'?value.bind(tx):value;}});`;
await build({entryPoints:[resolve(web,'tests/product-finish-assignment-native.mjs')],outfile:out,bundle:true,platform:'node',format:'esm',target:'node22',external:['@prisma/client','zod'],minify:true,tsconfig:resolve(web,'tsconfig.json'),banner:{js:"import {createRequire as __qaRequire} from 'node:module';const require=__qaRequire(process.cwd()+'/package.json');"},plugins:[{name:'finish-native-existing-guard-and-outer-transaction',setup(builder){
 builder.onLoad({filter:/product-attachments-native\.mjs$/},args=>{const source=readFileSync(args.path,'utf8'),cut=source.indexOf('async function main(');if(cut<0)throw Error('NATIVE_GUARD_SEAM_CHANGED');return{contents:source.slice(0,cut)+'\nexport {guard,fingerprint};',loader:'js',resolveDir:dirname(args.path)}});
 builder.onResolve({filter:/^@\/lib\/prisma$/},()=>({path:'prisma',namespace:'finish-native'}));builder.onLoad({filter:/.*/,namespace:'finish-native'},()=>({contents:proxy,loader:'js'}));
}}]});
const bytes=readFileSync(out);if(bytes.length>256*1024)throw Error('NATIVE_BUNDLE_LIMIT');console.log(JSON.stringify({kind:'product-finish-assignment-native-bundle',out,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),dbExecuted:false}));
