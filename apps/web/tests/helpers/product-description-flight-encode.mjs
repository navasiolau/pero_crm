// Только genuine установленный server.edge encoder; дочерний процесс нужен для react-server condition.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {renderToReadableStream,registerClientReference}=require('next/dist/compiled/react-server-dom-webpack/server.edge');
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);const input=JSON.parse(Buffer.concat(chunks));
let model={a:Promise.resolve(input.result),f:'',b:'qa-real-flight'},manifest={};
if(input.mode==='full-rsc')model.f=[require('react').createElement('div',null,'full card')];
if(input.mode==='module'){const ref=registerClientReference(function(){},'qa-module','default');model.a=Promise.resolve({...input.result,value:ref});manifest={'qa-module#default':{id:'qa-module',chunks:[],name:'default',async:false}};}
if(input.mode==='metadata')model.q='unrelated';
const stream=renderToReadableStream(model,manifest,{onError:()=>{}});const bytes=Buffer.from(await new Response(stream).arrayBuffer());process.stdout.write(bytes.toString('base64'));
