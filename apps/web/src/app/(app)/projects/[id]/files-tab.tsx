"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import type { FileSection } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { deleteFile } from "@/server/files/actions";
import {UploadErrorDetails} from "@/components/upload-error-details";
import {MULTI_UPLOAD_MAX_FILES,createUploadAttempt,sendUploadBatch,localUploadFailure,type BatchFileFailure,type BatchUploadItem} from "@/lib/file-upload-client";
import {PRODUCT_FILE_SECTIONS, FILE_SECTION_LABELS} from "@/lib/file-sections";

import {FileList, type FileListItem} from "@/components/file-list";

export interface FileRow extends FileListItem {
  section: FileSection;
}


// Раздел устанавливает место загрузки, без дополнительных полей формы.
export function Uploader({
  projectId,
  productId,
  canEdit,
  section = "GENERAL",
  header,
  onBusyChange,
}: {
  projectId: string;
  productId?: string;
  canEdit: boolean;
  section?: FileSection;
  compact?: boolean;
  header?: ReactNode;
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [batchFailures, setBatchFailures] = useState<BatchFileFailure[]>([]);
  const [batchSummary, setBatchSummary] = useState<{succeeded:number;total:number}|null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const currentTarget=useRef('');currentTarget.current=JSON.stringify({projectId,productId,section});
  const active = useRef(false);

  function buildForm(file:File){
    const form=new FormData();form.append('file',file);form.append('projectId',projectId);if(productId)form.append('productId',productId);form.append('section',section);return form;
  }

  // Пакетная загрузка: каждый файл — отдельный запрос со своим clientMutationId,
  // ошибка одного файла не валит пачку; в конце — один итог и список ошибок.
  function uploadFiles(selected:File[]){
    if(active.current||selected.length===0)return;
    const selectedTarget=currentTarget.current;active.current=true;
    onBusyChange?.(true);
    setBatchFailures([]);setBatchSummary(null);
    startTransition(async () => {
      try {
        const capped=selected.slice(0,MULTI_UPLOAD_MAX_FILES);
        const truncated=selected.length-capped.length;
        const items:BatchUploadItem[]=[];const failures:BatchFileFailure[]=[];
        for(const file of capped){
          items.push({fileName:file.name,size:file.size,attempt:createUploadAttempt(buildForm(file))});
        }
        const summary=await sendUploadBatch(items);if(currentTarget.current!==selectedTarget)return;
        for(const entry of summary.results){
          if(!entry.result.ok)failures.push({fileName:entry.fileName,failure:entry.result.failure});
        }
        const succeeded=summary.results.filter((entry)=>entry.result.ok).length,total=capped.length;
        setBatchFailures(failures);setBatchSummary({succeeded,total});
        if(truncated>0)toast.error(`Выбрано больше ${MULTI_UPLOAD_MAX_FILES} файлов — загружены первые ${MULTI_UPLOAD_MAX_FILES}.`);
        if(failures.length===0){
          toast.success(total===1?"Файл загружен":`Загружено ${succeeded} из ${total}`);
        }else if(succeeded>0){
          toast.error(`Загружено ${succeeded} из ${total}. Ошибок: ${failures.length}`);
        }else{
          toast.error(total===1&&failures[0]?failures[0].failure.error:`Не загружено ни одного файла из ${total}. Ошибок: ${failures.length}`);
        }
        if(succeeded>0)router.refresh();
      } catch {
        if(currentTarget.current!==selectedTarget)return;
        setBatchFailures([{fileName:"",failure:localUploadFailure("Не получено подтверждение загрузки.")}]);
        toast.error("Не получено подтверждение загрузки.");
      } finally { active.current=false;onBusyChange?.(false); }
    });
  }

  if (!canEdit) return null;

  const uploadControl = <>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = event.target.files ? Array.from(event.target.files) : [];
            event.target.value = "";
            if (files.length > 0) uploadFiles(files);
          }}
        />
        <Button disabled={pending} onClick={() => inputRef.current?.click()}>
          <Upload className="size-4" />
          {pending ? "Загрузка…" : "Загрузить файл"}
        </Button>
  </>;

  return (
    <Card>
      <CardContent className="flex min-w-0 flex-wrap items-end gap-3 p-4">
        {header ? <header className="flex w-full min-w-0 items-center justify-between gap-3">{header}{uploadControl}</header> : uploadControl}
        {batchSummary && batchFailures.length > 0 ? <div className="w-full min-w-0" role="alert">
          <p className="break-words text-sm text-destructive">Загружено {batchSummary.succeeded} из {batchSummary.total}. Ошибок: {batchFailures.length}</p>
          <ul className="mt-1 min-w-0 list-disc space-y-1 pl-5 text-sm text-destructive">
            {batchFailures.map((entry,index) => <li key={`${entry.fileName}-${index}`} className="break-words">{entry.fileName ? `«${entry.fileName}»: ` : ""}{entry.failure.error}</li>)}
          </ul>
        </div> : null}
        <UploadErrorDetails failure={batchFailures[0]?.failure ?? null} />
      </CardContent>
    </Card>
  );
}

// Единый список; публичные props контейнеров/разделов сохраняются для существующих экранов.
export function FileGridView({files, onBusyChange}: {
  flat?: boolean;
  files: FileRow[];
  canEdit: boolean;
  compact?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  return <FileList files={files} onDelete={file => deleteFile(file.id)}
    onDeleted={() => {toast.success("Файл удалён");router.refresh();}} onBusyChange={onBusyChange} />;
}

// Общие файлы проекта остаются плоским списком; изделие использует разделы.
export function FilesTab({projectId, productId, files, canEdit}: {
  projectId: string;
  productId?: string;
  files: FileRow[];
  canEdit: boolean;
  flatProject?: boolean;
}) {
  if (!productId) return <div className="flex min-w-0 flex-col gap-4" data-project-files="flat"><Uploader projectId={projectId} canEdit={canEdit} section="GENERAL" /><div className="flex min-w-0 flex-col gap-2"><FileGridView files={files} canEdit={canEdit} flat /></div></div>;

  return <div className="flex flex-col gap-6">
    {PRODUCT_FILE_SECTIONS.map(section => {
      const sectionFiles = files.filter(file => file.section === section || (section === "PRODUCTION" && file.section === "GENERAL"));
      return <section key={section} className="flex flex-col gap-3">
        <div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{FILE_SECTION_LABELS[section]}</h3><Badge variant="secondary">{sectionFiles.length}</Badge></div>
        <Uploader projectId={projectId} productId={productId} canEdit={canEdit} section={section} />
        <FileGridView files={sectionFiles} canEdit={canEdit} />
      </section>;
    })}
  </div>;
}
