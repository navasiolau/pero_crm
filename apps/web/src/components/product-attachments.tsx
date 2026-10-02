"use client";

import { useCallback, useEffect, useRef } from "react";
import type { FileCategory } from "@prisma/client";
import { Uploader, FileGridView, type FileRow } from "@/app/(app)/projects/[id]/files-tab";
import { useProductInline } from "@/components/product-inline-provider";
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
export function ProductDocuments({ production, installation, noModel: _noModel, canManage: _canManage, ...props }: Omit<ProductAttachmentProps, "files"> & { production: FileRow[]; installation: FileRow[]; noModel: boolean; canManage: boolean }) {
  return <div data-product-documents className="@container min-w-0 w-full max-w-full">
    <div className="grid min-w-0 grid-cols-1 gap-4 @min-[640px]:grid-cols-2">
      <div data-product-documents-column="production" className="flex min-w-0 flex-col gap-3"><AttachmentBlock {...props} files={production} title="Производство" stage="PRODUCTION" /></div>
      <div data-product-documents-column="installation" className="min-w-0"><AttachmentBlock {...props} files={installation} title="Монтаж" stage="INSTALLATION" /></div>
    </div>
  </div>;
}
