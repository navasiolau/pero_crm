"use client";

import * as React from "react";
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@prisma/client";
import { Maximize, Pencil } from "lucide-react";
import { toast } from "sonner";

import { ProductHeroImage } from "@/components/product-hero-image";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFileViewer } from "@/components/file-viewer";
import {
  canReplaceProductCover,
  getAttachedProductCoverChoices,
  getProductCoverActions,
  getProductCoverLayout,
  keepCurrentCoverOnFailure,
  refreshAfterCoverMutation,
  type ProductCoverChoice,
  type SketchFilePreview,
} from "@/lib/product-hero";
import { cn } from "@/lib/utils";

type CoverAction = (productId: string, fileId: string) => Promise<{ ok: boolean; error?: string }>;

type ProductCoverLayoutProps = {
  productId: string;
  projectId: string;
  cover: SketchFilePreview | null;
  attachedImages: ProductCoverChoice[];
  actorRoles: readonly Role[];
  canEditTechnicalBlock: boolean;
  setCoverAction: CoverAction;
  header: ReactNode;
  details: ReactNode;
  onRefresh?: () => void;
};

export function ProductCoverLayout({
  productId,
  projectId,
  cover: initialCover,
  attachedImages,
  actorRoles,
  canEditTechnicalBlock,
  setCoverAction,
  header,
  details,
  onRefresh,
}: ProductCoverLayoutProps) {
  const [cover, setCover] = useState(initialCover);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const coverViewer = useFileViewer("cover-fullscreen");
  const canReplace = canReplaceProductCover(actorRoles, canEditTechnicalBlock);
  const hasCover = !!cover;
  const layout = getProductCoverLayout(hasCover);
  const choices = getAttachedProductCoverChoices(attachedImages, productId, projectId);
  const actions = getProductCoverActions(hasCover, canReplace);

  useEffect(() => setCover(initialCover), [initialCover]);

  async function assignExisting(file: ProductCoverChoice) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await setCoverAction(productId, file.id);
      const next = keepCurrentCoverOnFailure(cover?.id ?? null, file.id, result);
      if (!result.ok || !next) {
        toast.error(result.error ?? "Не удалось заменить обложку");
        return;
      }
      setCover(file);
      setPickerOpen(false);
      refreshAfterCoverMutation(result, onRefresh);
      toast.success("Обложка заменена");
    } catch {
      toast.error("Не удалось заменить обложку");
    } finally {
      setBusy(false);
    }
  }

  async function uploadCover(file: File) {
    if (busy) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Выберите изображение");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("projectId", projectId);
      form.set("productId", productId);
      form.set("category", "PHOTO");
      form.set("assignCover", "1");
      const response = await fetch("/api/files/upload", { method: "POST", body: form });
      const result = await response.json().catch(() => null) as { ok?: boolean; id?: string; error?: string } | null;
      const nextId = typeof result?.id === "string" ? result.id : null;
      const next = keepCurrentCoverOnFailure(cover?.id ?? null, nextId ?? "", {
        ok: response.ok && result?.ok === true && !!nextId,
      });
      if (!response.ok || result?.ok !== true || !nextId || next !== nextId) {
        toast.error(result?.error ?? "Не удалось загрузить обложку");
        return;
      }
      setCover({ id: nextId, fileName: file.name, mimeType: file.type, hasThumb: false });
      setPickerOpen(false);
      refreshAfterCoverMutation({ ok: true }, onRefresh);
      toast.success("Обложка заменена");
    } catch {
      toast.error("Не удалось загрузить обложку");
    } finally {
      setBusy(false);
    }
  }

  function onUploadChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (file) void uploadCover(file);
  }

  return (
    <>
      <section
        data-slot="product-cover-layout"
        data-layout={layout}
        className={cn(
          "grid min-w-0 grid-cols-1 gap-4",
          hasCover && "lg:min-h-[calc(100dvh-8rem)] lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-[auto_1fr]",
        )}
      >
        <div data-slot="product-cover-header" className="order-1 flex min-w-0 items-start gap-2 lg:col-start-1 lg:row-start-1">
          <div className="min-w-0 flex-1">{header}</div>
          {!hasCover && canReplace ? (
            <button
              type="button"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Добавить обложку"
              onClick={() => setPickerOpen(true)}
            >
              <Pencil className="size-4" />
            </button>
          ) : null}
        </div>

        {cover ? (
          <div
            data-slot="product-cover-image"
            className="relative order-2 aspect-[4/5] min-w-0 overflow-hidden rounded-lg bg-muted/20 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:aspect-auto lg:h-full lg:min-h-[calc(100dvh-8rem)]"
          >
            <ProductHeroImage
              sketch={cover}
              preview="cover"
              priority
              errorDisplay="icon"
              alt="Обложка изделия"
              className="absolute inset-0 h-full w-full"
            />
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
              {actions.map((action) => (
                <button
                  key={action}
                  type="button"
                  className="inline-flex size-11 items-center justify-center rounded-md bg-background/85 text-foreground shadow-sm hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={action === "fullscreen" ? "Открыть обложку на весь экран" : "Заменить обложку"}
                  onClick={() => action === "fullscreen" ? coverViewer.open(cover) : setPickerOpen(true)}
                >
                  {action === "fullscreen" ? <Maximize className="size-4" /> : <Pencil className="size-4" />}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div data-slot="product-cover-details" className="order-3 min-w-0 lg:col-start-1 lg:row-start-2">
          {details}
        </div>
      </section>

      {coverViewer.viewer}

      <Dialog open={pickerOpen} onOpenChange={(open) => !busy && setPickerOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Выберите обложку</DialogTitle>
            <DialogDescription>Выберите изображение изделия или загрузите новое.</DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[55vh] grid-cols-2 gap-3 overflow-auto sm:grid-cols-3">
            {choices.map((file) => (
              <button
                key={file.id}
                type="button"
                disabled={busy}
                aria-label={`Назначить изображение ${file.fileName} обложкой`}
                className="relative aspect-[4/5] overflow-hidden rounded-md border bg-muted/20 disabled:opacity-50"
                onClick={() => void assignExisting(file)}
              >
                <ProductHeroImage
                  sketch={file}
                  preview="card"
                  alt=""
                  className="absolute inset-0 h-full w-full"
                />
              </button>
            ))}
          </div>
          <input
            ref={uploadInput}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label="Загрузить новое изображение обложки"
            onChange={onUploadChange}
          />
          <button
            type="button"
            disabled={busy}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-primary-foreground disabled:pointer-events-none disabled:opacity-50"
            onClick={() => uploadInput.current?.click()}
          >
            Загрузить новое фото
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ProductCoverClient(props: Omit<ProductCoverLayoutProps, "onRefresh">) {
  const router = useRouter();
  return <ProductCoverLayout {...props} onRefresh={() => router.refresh()} />;
}
