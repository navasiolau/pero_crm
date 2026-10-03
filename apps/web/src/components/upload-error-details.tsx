"use client";
import * as React from "react";
import {useRef,useState} from "react";
import {Copy,Check} from "lucide-react";
import {formatUploadDiagnostics,copyUploadDiagnostics,type UploadFailure} from "@/lib/file-upload-client";
export function UploadErrorDetails({failure}:{failure:UploadFailure|null}) {
 if(!failure)return null;
 return <UploadErrorContent key={formatUploadDiagnostics(failure)} failure={failure} />;
}
function UploadErrorContent({failure}:{failure:UploadFailure}) {
 const textarea=useRef<HTMLTextAreaElement>(null);const[copied,setCopied]=useState(false);const[copyFailed,setCopyFailed]=useState(false);
 return <div className="w-full min-w-0 max-w-full space-y-2" data-upload-error>
  <p role="alert" className="min-w-0 break-words text-sm text-destructive">{failure.error}</p>
  <details className="min-w-0 max-w-full rounded-md border p-2" key={formatUploadDiagnostics(failure)}>
   <summary className="cursor-pointer text-sm font-medium">Технические подробности</summary>
   <div className="relative mt-2 min-w-0">
    <textarea ref={textarea} readOnly aria-label="Технические подробности файловой операции" value={formatUploadDiagnostics(failure)} className="h-44 min-w-0 w-full max-w-full resize-y rounded-md border bg-muted/30 p-2 pr-12 font-mono text-xs leading-relaxed outline-none" />
    <button type="button" aria-label="Копировать технические подробности" className="absolute top-1 right-1 flex size-11 items-center justify-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" onClick={async()=>{try{await copyUploadDiagnostics(failure,undefined,textarea.current??undefined);setCopied(true);setCopyFailed(false);}catch{setCopyFailed(true);setCopied(false);textarea.current?.focus({preventScroll:true});textarea.current?.select();}}}>{copied?<Check className="size-4" />:<Copy className="size-4" />}</button>
   </div>
   {copyFailed?<p role="alert" className="mt-1 text-sm text-destructive">Не удалось скопировать. Текст выделен — используйте Ctrl+C.</p>:null}
   <span role="status" className="sr-only">{copied?"Скопировано":""}</span>
  </details>
 </div>;
}
