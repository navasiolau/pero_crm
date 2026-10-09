"use client";

import { useCallback, useEffect, useRef } from "react";
import type {FileSection} from "@prisma/client";
import { Uploader, FileGridView, type FileRow } from "@/app/(app)/projects/[id]/files-tab";
import { useProductInline } from "@/components/product-inline-provider";

export type ProductAttachmentProps = { projectId: string; productId: string; files: FileRow[]; canEdit: boolean };
function useAttachmentBarrier(key: string) {
  const { registerGuard } = useProductInline();
  const busy = useRef({ upload: false, deletion: false });
  useEffect(() => registerGuard(key, async () => !busy.current.upload && !busy.current.deletion), [registerGuard, key]);
  const upload = useCallback((value: boolean) => { busy.current.upload = value; }, []);
  const deletion = useCallback((value: boolean) => { busy.current.deletion = value; }, []);
  return { upload, deletion };
}
function AttachmentBlock({ title, section, measurement, ...props }: ProductAttachmentProps & { title: string; section: Exclude<FileSection, "GENERAL">; measurement?: boolean }) {
  const busy = useAttachmentBarrier(`attachments-${measurement ? "measurement" : section}`);
  return <section className="min-w-0" aria-label={title}>
    <Uploader projectId={props.projectId} productId={props.productId} canEdit={props.canEdit} section={section} compact onBusyChange={busy.upload}
      header={<h2 className="min-w-0 flex-1 break-words text-sm font-semibold">{title} <span className="text-muted-foreground">({props.files.length})</span></h2>}>
      <FileGridView files={props.files} canEdit={props.canEdit} compact onBusyChange={busy.deletion} />
    </Uploader>
  </section>;
}
export function ProductMeasurement(props: ProductAttachmentProps) {
  return <div data-product-measurement className="min-w-0"><AttachmentBlock {...props} title="Замер" section="MEASUREMENT" measurement /></div>;
}
export function ProductDocuments({ production, installation, noModel: _noModel, canManage: _canManage, ...props }: Omit<ProductAttachmentProps, "files"> & { production: FileRow[]; installation: FileRow[]; noModel: boolean; canManage: boolean }) {
  return <div data-product-documents className="@container min-w-0 w-full max-w-full">
    <div className="grid min-w-0 grid-cols-1 gap-4 @min-[640px]:grid-cols-2">
      <div data-product-documents-column="production" className="flex min-w-0 flex-col gap-3"><AttachmentBlock {...props} files={production} title="Производство" section="PRODUCTION" /></div>
      <div data-product-documents-column="installation" className="min-w-0"><AttachmentBlock {...props} files={installation} title="Монтаж" section="INSTALLATION" /></div>
    </div>
  </div>;
}
