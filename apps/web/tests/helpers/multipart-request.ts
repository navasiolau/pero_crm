// Реальный малый multipart fixture: нет IO, сети или чтения File при импорте.
const encoder=new TextEncoder();
type Entry=[string,FormDataEntryValue|null|undefined];
type Options={declared?:boolean;contextHeader?:string;chunkBytes?:number;signal?:AbortSignal;onPull?:()=>void;onCancel?:()=>void;boundary?:string};
const contextKeys=new Set(["projectId","productId","taskId","section","assignCover","assignProjectCover","expectedSketchFileId","expectedCoverFileId","clientMutationId"]);
const quoted=(value:string)=>value.replace(/\r/g,"%0D").replace(/\n/g,"%0A").replace(/"/g,"%22");
export function multipartRequest(values:Record<string,unknown>|Entry[],options:Options={}):Request {
 const entries:Entry[]=Array.isArray(values)?values:Object.entries(values).map(([key,value])=>[key,value instanceof File||typeof value==="string"?value:value===null||value===undefined?undefined:String(value)]),boundary=options.boundary??"qa-multipart-139";
 let activeReader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 async function* parts(){
  for(const[name,value]of entries){
   if(value===null||value===undefined)continue;
   if(value instanceof File){
    yield encoder.encode("--"+boundary+'\r\nContent-Disposition: form-data; name="'+quoted(name)+'"; filename="'+quoted(value.name)+'"\r\nContent-Type: '+(value.type||"application/octet-stream")+"\r\n\r\n");
    const reader=value.stream().getReader();activeReader=reader;let done=false;
    try{while(true){const next=await reader.read();if(next.done){done=true;break;}yield next.value;}}
    finally{if(!done)await reader.cancel().catch(()=>{});reader.releaseLock();if(activeReader===reader)activeReader=undefined;}
   }else yield encoder.encode("--"+boundary+'\r\nContent-Disposition: form-data; name="'+quoted(name)+'"\r\n\r\n'+value);
   yield encoder.encode("\r\n");
  }
  yield encoder.encode("--"+boundary+"--\r\n");
 }
 async function* chunks(){for await(const part of parts()){const size=options.chunkBytes??4096;for(let at=0;at<part.length;at+=size)yield part.subarray(at,at+size);}}
 const iterator=chunks(),body=new ReadableStream<Uint8Array>({
  async pull(controller){options.onPull?.();try{const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(next.value);}catch(error){controller.error(error);}},
  async cancel(){options.onCancel?.();await activeReader?.cancel().catch(()=>{});await iterator.return(undefined);}
 },{highWaterMark:0});
 const headers=new Headers({"content-type":"multipart/form-data; boundary="+boundary});
 if(options.contextHeader!==undefined)headers.set("x-pero-upload-context",options.contextHeader);
 else if(options.declared){const fields=Object.fromEntries(entries.filter(([key,value])=>contextKeys.has(key)&&typeof value==="string"));headers.set("x-pero-upload-context",encodeURIComponent(JSON.stringify({version:1,fields})));}
 return new Request("https://upload.test/api/files/upload",{method:"POST",headers,body,signal:options.signal,duplex:"half"} as RequestInit&{duplex:"half"});
}
