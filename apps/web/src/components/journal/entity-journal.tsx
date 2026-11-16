"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { JournalScope } from "@/server/changelog/contract";
import { Journal } from "@/components/journal/journal";

type EntityScope = Exclude<JournalScope, { kind: "global" }>;

/** Родительская server page создаёт этот компонент исключительно для ADMIN. */
export function EntityJournal({ scope, whenVisible = false }: { scope: EntityScope; whenVisible?: boolean }) {
  return <JournalMount key={`${scope.kind}:${scope.id}:${whenVisible}`} scope={scope} whenVisible={whenVisible}/>;
}

function JournalMount({ scope, whenVisible }: { scope: EntityScope; whenVisible: boolean }) {
  const [ready, setReady] = useState(!whenVisible);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ready || !container.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); setReady(true); }
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [ready]);
  return <div ref={container} className="min-w-0" data-entity-journal={scope.kind} data-entity-id={scope.id}>
    {ready ? <Journal scope={scope}/> : <div className="flex min-h-32 flex-col items-start justify-center gap-3 rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">История появится при просмотре этого раздела.</p>
      <Button type="button" variant="outline" onClick={() => setReady(true)}>Загрузить журнал</Button>
    </div>}
  </div>;
}
