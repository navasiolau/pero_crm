// Контекст не содержит файл, его байты или клиентский хеш.
export const UPLOAD_CONTEXT_HEADER="x-pero-upload-context";
export const UPLOAD_CONTEXT_MAX_BYTES=4096;
export const UPLOAD_CONTEXT_FIELDS=["projectId","productId","taskId","section","assignCover","assignProjectCover","expectedSketchFileId","expectedCoverFileId","clientMutationId"] as const;
export type UploadRequestFields=Record<string,string>;
const plain=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==="object"&&!Array.isArray(value));
export function declaredUploadHeader(form:FormData):string|undefined {
 const fields:UploadRequestFields={};
 for(const key of UPLOAD_CONTEXT_FIELDS){const values=form.getAll(key);if(values.length>1||values.some(value=>typeof value!=="string"))return undefined;if(values.length)fields[key]=values[0] as string;}
 if(!Object.hasOwn(fields,"projectId"))return undefined;
 const value=encodeURIComponent(JSON.stringify({version:1,fields}));return value.length<=UPLOAD_CONTEXT_MAX_BYTES?value:undefined;
}
export function parseUploadContextHeader(value:string|null):UploadRequestFields|null|false {
 if(value===null)return null;
 if(!value.length||value.length>UPLOAD_CONTEXT_MAX_BYTES||!/^[\x20-\x7e]+$/.test(value))return false;
 try{
  const body:unknown=JSON.parse(decodeURIComponent(value));
  if(!plain(body)||Object.keys(body).sort().join("|")!=="fields|version"||body.version!==1||!plain(body.fields))return false;
  const fields=body.fields;
  if(!Object.hasOwn(fields,"projectId")||Object.entries(fields).some(([key,item])=>!UPLOAD_CONTEXT_FIELDS.includes(key as typeof UPLOAD_CONTEXT_FIELDS[number])||typeof item!=="string"))return false;
  return {...fields} as UploadRequestFields;
 }catch{return false;}
}
function normalized(fields:UploadRequestFields,key:typeof UPLOAD_CONTEXT_FIELDS[number]){
 if(key==="section")return fields[key]??"GENERAL";
 if(key==="productId"||key==="taskId")return fields[key]||undefined;
 return fields[key];
}
export function matchesDeclaredUploadContext(declared:UploadRequestFields,actual:UploadRequestFields){
 return UPLOAD_CONTEXT_FIELDS.every(key=>normalized(declared,key)===normalized(actual,key));
}
