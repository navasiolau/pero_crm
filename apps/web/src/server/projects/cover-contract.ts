import {z} from 'zod';
const id=z.string().min(1).max(128);
export const projectCoverUploadSchema=z.object({projectId:id,expectedCoverFileId:z.null(),clientMutationId:z.uuid()}).strict();
export const projectCoverDeleteSchema=z.object({projectId:id,expectedCoverFileId:id,clientMutationId:z.uuid()}).strict();
export type ProjectCoverUpload=z.infer<typeof projectCoverUploadSchema>;
export type ProjectCoverDelete=z.infer<typeof projectCoverDeleteSchema>;
export type ProjectCoverPreview={id:string;fileName:string;mimeType:string;hasThumb:boolean};
export type ProjectCoverResult={ok:true;coverFileId:string|null;clientMutationId:string;id?:string;repeated?:boolean;
  storageIntent?:{projectId:string;fileId:string;storedName:string;hasThumb:boolean}}|
  {ok:false;kind:'validation'|'conflict'|'forbidden'|'not-found'|'failure';error:string;currentCoverFileId?:string|null};
