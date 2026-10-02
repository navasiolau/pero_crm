import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const React=require('react'),{renderToReadableStream,registerClientReference,registerServerReference}=require('next/dist/compiled/react-server-dom-webpack/server.edge');
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);const input=JSON.parse(Buffer.concat(chunks));
const moduleId='qa-components',client=registerClientReference(function(){},moduleId,'default'),server=registerServerReference(async()=>{},'qa-server','default');
const model={a:Promise.resolve(input.result),f:[React.createElement(client,{nested:React.createElement('div',null,'  Full RSC\n'+('X'.repeat(1500))),server})],b:'qa-next-build'};
const manifest={'qa-components#default':{id:'qa-components',chunks:[],name:'default',async:false}};const stream=renderToReadableStream(model,manifest,{onError:()=>{}});process.stdout.write(Buffer.from(await new Response(stream).arrayBuffer()).toString('base64'));
