"use client";
import { Paperclip } from "lucide-react";
import { FileList } from "@/components/file-list";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type {ViewableFile} from "@/lib/viewable-file";

/** Финансовый документ: текущий backend не предоставляет отдельного удаления. */
export function ReportDocumentButton({ document, documents, compact = false }: {
  document?: ViewableFile | null;
  documents?: readonly ViewableFile[];
  compact?: boolean;
}) {
  const files = documents ?? (document ? [document] : []);
  if (!files.length) return null;
  const list = <FileList files={files.map(file => ({ ...file, source: file.source ?? "finance", canDelete: false }))} />;
  if (!compact) return list;

  return (
    <div className="inline-flex" onClick={event => event.stopPropagation()}>
      <Dialog>
        <DialogTrigger
          render={<Button type="button" variant="ghost" size="sm" className="min-h-11 text-muted-foreground md:min-h-7" />}
          aria-label={`Документы, ${files.length}`}
        >
          <Paperclip aria-hidden="true" />
          {files.length}
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Документы</DialogTitle>
          </DialogHeader>
          {list}
        </DialogContent>
      </Dialog>
    </div>
  );
}
