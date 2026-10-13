// Build only; external S3 SDK is the real Next server external package, never a stub.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx/package.json'))('esbuild');
const web=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function bundleProductAttachmentsQa(entry){
 if(!['product-attachments-fixtures.mjs','product-attachments-session.mjs'].includes(entry))throw Error('PROJECT_QA_ENTRY_REQUIRED');
 const session=entry==='product-attachments-session.mjs';
 const result=await build({entryPoints:[path.join(web,'tests',session?'crm-modernization-session.mjs':entry)],bundle:true,write:false,platform:'node',format:'esm',target:'node22',external:['@prisma/client','@aws-sdk/client-s3'],minify:true,tsconfig:path.join(web,'tsconfig.json'),logLevel:'silent',...(session?{define:{__QA_SESSION_POLICY__:'"attachments"'}}:{})});
 const bytes=Buffer.from(result.outputFiles[0].contents);if(bytes.length>256*1024)throw Error('REVIEWED_QA_BUNDLE_LIMIT_EXCEEDED');return bytes;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const[entry,out]=process.argv.slice(2);if(!out)throw Error('EXPLICIT_OUTPUT_REQUIRED');const bytes=await bundleProductAttachmentsQa(entry);await writeFile(path.resolve(out),bytes,{mode:0o600});console.log(JSON.stringify({entry,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),dbExecuted:false,storageExecuted:false,externalRealS3Sdk:true}));}
