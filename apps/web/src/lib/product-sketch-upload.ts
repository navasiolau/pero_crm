import {isCoverImageMime} from './product-cover';
import {sketchUploadTargetSchema} from '@/server/products/sketch-contract';
/** Original File is appended verbatim; never infer MIME or re-encode an image. */
export function sketchUploadForm(file:File,projectId:string,productId:string,clientMutationId:string,expectedSketchFileId:string|null=null):FormData{
 const target=sketchUploadTargetSchema.parse({projectId,productId,expectedSketchFileId,clientMutationId});
 if(!isCoverImageMime(file.type))throw Error('Выберите изображение поддерживаемого формата.');
 if(file.size<=0||file.size>25*1024*1024)throw Error('Изображение должно быть непустым и не больше 25 МБ.');
 const form=new FormData();form.append('file',file);form.append('projectId',target.projectId);form.append('productId',target.productId);form.append('category','PHOTO');form.append('assignCover','1');form.append('expectedSketchFileId',target.expectedSketchFileId??'null');form.append('clientMutationId',target.clientMutationId);return form;
}
