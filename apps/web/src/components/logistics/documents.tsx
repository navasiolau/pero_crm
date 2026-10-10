"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getViewableFileSource, useFileViewer } from "@/components/file-viewer";
import type { LogisticsDocumentView } from "@/server/logistics/contracts";

export function LogisticsDocuments({ documents }: { documents: readonly LogisticsDocumentView[] }) {
  const viewer = useFileViewer();
  return (
    <div className="min-w-0 space-y-2" onClick={event => event.stopPropagation()}>
      {!documents.length && <p className="text-sm text-muted-foreground">ТТН пока не загружены</p>}
      <div role="list" className="min-w-0 space-y-3">
        {documents.map(document => (
          <div key={document.id} role="listitem" className="min-w-0 rounded-lg border p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant={document.stage === "SIGNED" ? "secondary" : "outline"}>
                {document.stage === "SIGNED" ? "Две печати" : "Одна печать"}
              </Badge>
              <span className="text-sm">{document.ttnNumber ? "ТТН № " + document.ttnNumber : "Номер ТТН не указан"}</span>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <button type="button" className="min-w-0 flex-1 break-all text-left text-sm underline underline-offset-4"
                onClick={() => viewer.open(document)}>{document.fileName}</button>
              <a href={getViewableFileSource(document)} download={document.fileName}>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={"Скачать " + document.fileName}>
                  <Download className="size-4" />
                </Button>
              </a>
            </div>
          </div>
        ))}
      </div>
      {viewer.viewer}
    </div>
  );
}
