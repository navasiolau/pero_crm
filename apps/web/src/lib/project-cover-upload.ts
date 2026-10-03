import {createUploadAttempt} from './file-upload-client';
import {isCoverImageMime} from './product-cover';
import type {ProjectCoverPreview} from '@/server/projects/cover-contract';
export function projectCoverAttempt(file:File,projectId:string){
 if(!isCoverImageMime(file.type)||file.size>25*1024*1024)throw Error('Выберите изображение поддерживаемого формата не больше 25 МБ');
 const form=new FormData();form.append('file',file);form.append('projectId',projectId);form.append('category','PHOTO');form.append('assignProjectCover','1');form.append('expectedCoverFileId','null');return createUploadAttempt(form);
}
export function confirmedProjectCover(data:Record<string,unknown>,mutationId:string):ProjectCoverPreview{
 const cover=data.cover as Partial<ProjectCoverPreview>|null;
 if(data.ok!==true||data.clientMutationId!==mutationId||typeof data.id!=='string'||data.coverFileId!==data.id||!cover||cover.id!==data.id||typeof cover.fileName!=='string'||typeof cover.mimeType!=='string'||!isCoverImageMime(cover.mimeType)||typeof cover.hasThumb!=='boolean')throw Error('Не получено подтверждение обложки. Повторите прежний запрос.');
 return cover as ProjectCoverPreview;
}
