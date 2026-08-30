"use client";

import { FileImage } from "lucide-react";

import { useFileViewer } from "@/components/file-viewer";

export interface SketchFile {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
}

// Эскиз изделия: миниатюра в детальном просмотре, клик — лайтбокс.
// В списке изделий эскиз не выводится.
export function ProductSketch({ sketch }: { sketch: SketchFile }) {
  const { open, viewer } = useFileViewer();

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className="group relative flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40"
        onClick={() => open(sketch)}
        aria-label="Открыть эскиз"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/files/${sketch.id}`}
          alt={sketch.fileName}
          className="h-full w-full object-contain transition-transform group-hover:scale-105"
        />
      </button>
      <div className="flex min-w-0 flex-col text-sm">
        <div className="flex items-center gap-1.5 font-medium">
          <FileImage className="size-4 shrink-0 text-muted-foreground" />
          Эскиз изделия
        </div>
        <span className="truncate text-muted-foreground">{sketch.fileName}</span>
        <button
          type="button"
          className="w-fit text-left text-foreground underline-offset-2 hover:underline"
          onClick={() => open(sketch)}
        >
          Открыть
        </button>
      </div>
      {viewer}
    </div>
  );
}
