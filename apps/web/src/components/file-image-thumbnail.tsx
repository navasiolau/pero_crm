"use client";
import {useState} from "react";
import {ImageOff} from "lucide-react";
export type ThumbnailFile={id:string;fileName:string;mimeType:string};
export function FileImageThumbnail({file,onOpen}:{file:ThumbnailFile;onOpen:()=>void}){
 const src=`/api/files/${encodeURIComponent(file.id)}?preview=thumbnail`;
 const[failed,setFailed]=useState<string|null>(null);
 if(!file.mimeType.startsWith("image/"))return null;
 return <button type="button" className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/30" data-file-thumbnail={file.id} aria-label={`Просмотреть ${file.fileName}`} onClick={event=>{event.stopPropagation();onOpen();}}>
 {failed===src?<ImageOff className="size-5 text-muted-foreground" aria-label="Превью не загрузилось"/>:
 // eslint-disable-next-line @next/next/no-img-element
 <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-contain" onError={()=>setFailed(src)}/>}
 </button>;
}
