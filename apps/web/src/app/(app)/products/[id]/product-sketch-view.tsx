"use client";
import { createRequestId } from "@/lib/request-id";

import * as React from "react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Role } from "@prisma/client";
import { Trash2 } from "lucide-react";
import { ProductHeroImage } from "@/components/product-hero-image";
import { PhotoUploadButton } from "@/components/photo-upload-button";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { useFileViewer } from "@/components/file-viewer";
import { canReplaceProductCover, type SketchFilePreview } from "@/lib/product-hero";
import { isConfirmedSketchDelete } from "@/lib/product-sketch-ui";

import type { SketchDeleteInput as DeleteSketchInput, SketchResult as DeleteSketchResult } from "@/server/products/sketch-contract";
type ProductCoverLayoutProps = {
  productId:string;projectId:string;cover:SketchFilePreview|null;actorRoles:readonly Role[];canEditTechnicalBlock:boolean;canDeleteCover?:boolean;
  deleteCoverAction:(input:DeleteSketchInput)=>Promise<DeleteSketchResult>;
  header:ReactNode;details:ReactNode;onRefresh?:()=>void;beforeMutation?:()=>Promise<boolean>;registerGuard?:(key:string,guard:()=>Promise<boolean>)=>()=>void;
};
export function ProductCoverLayout({productId,projectId,cover:initialCover,actorRoles,canEditTechnicalBlock,canDeleteCover,deleteCoverAction,header,details,onRefresh,beforeMutation,registerGuard}:ProductCoverLayoutProps) {
  const [cover,setCover]=useState(initialCover);
  const [deleteFor,setDeleteFor]=useState<SketchFilePreview|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const pending=useRef(false);
  const uncertainUpload=useRef(false);
  const uncertainDelete=useRef(false);
  const awaiting=useRef<{id:string|null}|null>(null);
  const deleteAttempt=useRef<DeleteSketchInput|null>(null);
  const viewer=useFileViewer("cover-fullscreen");
  const canUpload=canReplaceProductCover(actorRoles,canEditTechnicalBlock);
  const canDelete=canDeleteCover??canUpload;
  useEffect(()=>{
    if(pending.current)return;
    if(awaiting.current&&awaiting.current.id!==(initialCover?.id??null))return;
    awaiting.current=null;setCover(initialCover);
  },[initialCover]);
  useEffect(()=>registerGuard?.("product-sketch",async()=>!pending.current&&!uncertainUpload.current&&!uncertainDelete.current),[registerGuard]);
  function changeBusy(value:boolean){pending.current=value;setBusy(value);}
  async function flushCritical(){ return beforeMutation ? beforeMutation() : true; }
  async function remove(){
    if(pending.current||!deleteFor||!deleteCoverAction)return false;
    changeBusy(true);setError(null);
    try {
      if(!await flushCritical())throw Error("Сначала сохраните цену, количество и инженера изделия.");
      if(!deleteAttempt.current||deleteAttempt.current.expectedSketchFileId!==deleteFor.id)deleteAttempt.current={productId,expectedSketchFileId:deleteFor.id,clientMutationId:createRequestId()};
      const request=deleteAttempt.current;
      uncertainDelete.current=true;
      const result=await deleteCoverAction(request);
      if(!result.ok){uncertainDelete.current=false;deleteAttempt.current=null;throw Error(result.error??"Не удалось удалить эскиз");}
      if(!isConfirmedSketchDelete(result,request.clientMutationId))throw Error("Не получено подтверждение удаления. Повторите запрос.");
      uncertainDelete.current=false;deleteAttempt.current=null;awaiting.current={id:null};setCover(null);onRefresh?.();return true;
    }catch(failure){setError(failure instanceof Error?failure.message:"Не удалось удалить эскиз");return false;}
    finally{changeBusy(false);}
  }
  return <>
    <section data-layout="cover" className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-[auto_auto]">
      <div data-slot="product-cover-header" className="order-1 min-w-0 lg:col-start-1 lg:row-start-1">{header}</div>
      <div data-slot="product-cover-image" data-sketch-state={cover?"filled":"empty"} className="relative order-2 aspect-[4/5] min-w-0 overflow-hidden rounded-lg border bg-muted/20 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:aspect-auto lg:self-start lg:h-[max(8rem,calc(100svh-8.75rem))]">
        {cover?<>
          <button type="button" aria-label="Открыть эскиз на весь экран" className="absolute inset-0 h-full w-full" onClick={()=>viewer.open(cover)}><ProductHeroImage sketch={cover} preview="cover" priority alt="Эскиз изделия" className="absolute inset-0 h-full w-full" /></button>
          {canDelete?<button type="button" aria-label="Удалить эскиз" disabled={busy} className="absolute top-2 right-2 z-10 inline-flex size-10 items-center justify-center rounded-md bg-background/85 shadow-sm disabled:opacity-50" onClick={()=>{setError(null);if(!uncertainDelete.current)deleteAttempt.current=null;setDeleteFor(cover);}}><Trash2 className="size-5 text-destructive" /></button>:null}
        </>:canUpload?<PhotoUploadButton projectId={projectId} productId={productId} assignCover coverSurface filesCount={0} buttonLabel="Добавить изображение" onBusyChange={changeBusy} onUncertainChange={value=>{uncertainUpload.current=value;}} beforeUpload={flushCritical} onUploaded={(_id,sketch)=>{if(sketch){awaiting.current={id:sketch.id};setCover(sketch);setError(null);}}} />:<div className="flex h-full min-h-48 items-center justify-center p-4 text-center"><p className="text-sm text-muted-foreground">Добавьте эскиз</p></div>}
        {busy?<p aria-live="polite" className="absolute bottom-2 left-2 rounded bg-background/90 p-2 text-xs">Сохраняется…</p>:null}
        {error?<p role="alert" className="absolute right-2 bottom-2 left-2 min-w-0 break-words rounded bg-background/95 p-2 text-sm text-destructive">{error}</p>:null}
      </div>
      <div data-slot="product-cover-details" className="order-3 min-w-0 lg:col-start-1 lg:row-start-2">{details}</div>
    </section>
    {viewer.viewer}
    <ConfirmDeleteDialog entityLabel={`эскиз «${deleteFor?.fileName??""}»`} open={!!deleteFor} onOpenChange={open=>{if(!open&&!pending.current){setDeleteFor(null);if(!uncertainDelete.current)deleteAttempt.current=null;}}} onConfirm={remove} />
  </>;
}
