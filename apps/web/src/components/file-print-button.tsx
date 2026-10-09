"use client";

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getPrintableFileKind, printViewableFile } from '@/lib/browser-file-print';
import type { ViewableFile } from '@/lib/viewable-file';

/** Независимое действие строки: печать выбранного оригинала, без открытия/скачивания. */
export function FilePrintButton({ file, disabled = false }: { file: ViewableFile; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const preparing = useRef(false), current = useRef<AbortController | null>(null), mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; current.current?.abort(); };
  }, [file.id, file.source]);
  if (!getPrintableFileKind(file)) return null;
  return <Button type="button" size="icon-sm" variant="ghost" className="shrink-0" disabled={disabled || busy}
    aria-label={`Распечатать ${file.fileName}`} aria-busy={busy || undefined}
    title={busy ? 'Подготовка к печати…' : 'Распечатать'} onClick={async event => {
      event.stopPropagation();
      if (disabled || preparing.current) return;
      preparing.current = true;
      current.current?.abort();
      const controller = new AbortController(); current.current = controller;
      setBusy(true);
      try { await printViewableFile(file, { signal: controller.signal }); }
      catch (error) {
        if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : 'Не удалось распечатать файл');
      } finally {
        preparing.current = false;
        if (mounted.current) setBusy(false);
      }
    }}>
    {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Printer className="size-4" />}
  </Button>;
}
