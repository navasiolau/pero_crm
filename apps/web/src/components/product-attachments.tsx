"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FileCategory } from "@prisma/client";
import { Uploader, FileGridView, type FileRow } from "@/app/(app)/projects/[id]/files-tab";
import { useProductInline } from "@/components/product-inline-provider";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { setProductNoModelAction } from "@/server/product-percentage-pay/actions";
import { PhotoUploadButton } from "@/components/photo-upload-button";

export type ProductAttachmentProps = { projectId: string; productId: string; files: FileRow[]; canEdit: boolean; extensions?: Record<FileCategory, string[]> };
function useAttachmentBarrier(key: string) {
  const { registerGuard } = useProductInline();
  const busy = useRef({ upload: false, photo: false, deletion: false });
  useEffect(() => registerGuard(key, async () => !busy.current.upload && !busy.current.photo && !busy.current.deletion), [registerGuard, key]);
  const upload = useCallback((value: boolean) => { busy.current.upload = value; }, []);
  const deletion = useCallback((value: boolean) => { busy.current.deletion = value; }, []);
  const photo = useCallback((value: boolean) => { busy.current.photo = value; }, []);
  return { upload, deletion, photo };
}
function AttachmentBlock({ title, stage, measurement, ...props }: ProductAttachmentProps & { title: string; stage: "PRODUCTION" | "INSTALLATION"; measurement?: boolean }) {
  const busy = useAttachmentBarrier(`attachments-${measurement ? "measurement" : stage}`);
  return <section className="flex min-w-0 flex-col gap-3" aria-label={title}>
    <h2 className="text-sm font-semibold">{title} <span className="text-muted-foreground">({props.files.length})</span></h2>
    {measurement && props.canEdit ? <div className="min-w-0"><PhotoUploadButton projectId={props.projectId} productId={props.productId} stage="PRODUCTION" filesCount={props.files.filter(file => file.mimeType.startsWith("image/")).length} extensions={props.extensions?.MEASUREMENT} onBusyChange={busy.photo} /></div> : null}
    <Uploader projectId={props.projectId} productId={props.productId} canEdit={props.canEdit} stage={stage} extensions={props.extensions} fixedCategory={measurement ? "MEASUREMENT" : undefined} excludeMeasurement={!measurement} compact onBusyChange={busy.upload} />
    <FileGridView files={props.files} canEdit={props.canEdit} compact onBusyChange={busy.deletion} />
  </section>;
}
export function ProductMeasurement(props: ProductAttachmentProps) {
  return <div data-product-measurement className="min-w-0"><AttachmentBlock {...props} title="Замер" stage="PRODUCTION" measurement /></div>;
}
function ProductNoModel({ productId, noModel, canManage }: { productId: string; noModel: boolean; canManage: boolean }) {
  const router = useRouter();
  const { registerGuard } = useProductInline();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(noModel);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setConfirmed(noModel); }, [noModel]);
  useEffect(() => registerGuard("attachments-no-model", async () => !busy.current), [registerGuard]);
  async function save(value: boolean) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null);
    try {
      const result = await setProductNoModelAction({productId, noModel: value});
      if (!result.ok) throw Error(result.error ?? "Не удалось сохранить отметку");
      setConfirmed(value); router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось сохранить отметку"); }
    finally { busy.current = false; setPending(false); }
  }
  return <div className="min-w-0 rounded-lg border p-3">
    {canManage ? <div className="flex min-w-0 items-start gap-3"><Checkbox id="product-no-model" checked={confirmed} disabled={pending} onCheckedChange={value => {if(typeof value === "boolean")void save(value);}} /><Label htmlFor="product-no-model">Модели нет</Label></div> : <p className="text-sm">Модели нет: {confirmed ? "Да" : "Нет"}</p>}
    <p className="mt-1 break-words text-xs text-muted-foreground">Инженер сможет вручную перевести изделие из проектирования в производство при наличии модели или подтверждённой отметки.</p>
    {pending ? <p aria-live="polite" className="text-xs text-muted-foreground">Сохраняется…</p> : null}
    {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
  </div>;
}
export function ProductDocuments({ production, installation, noModel, canManage, ...props }: Omit<ProductAttachmentProps, "files"> & { production: FileRow[]; installation: FileRow[]; noModel: boolean; canManage: boolean }) {
  return <div data-product-documents className="@container min-w-0 w-full max-w-full">
    <div className="grid min-w-0 grid-cols-1 gap-4 @min-[640px]:grid-cols-2">
      <div data-product-documents-column="production" className="flex min-w-0 flex-col gap-3"><AttachmentBlock {...props} files={production} title="Производство" stage="PRODUCTION" /><ProductNoModel productId={props.productId} noModel={noModel} canManage={canManage} /></div>
      <div data-product-documents-column="installation" className="min-w-0"><AttachmentBlock {...props} files={installation} title="Монтаж" stage="INSTALLATION" /></div>
    </div>
  </div>;
}
