"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { JournalScope } from "@/server/changelog/contract";
import { previewJournalReversal, reverseJournalAction } from "@/server/changelog/reversal-actions";

type Preview = Extract<Awaited<ReturnType<typeof previewJournalReversal>>, { ok: true }>;

export function JournalReversal({ entryId, scope, onReversed }: { entryId: string; scope: JournalScope; onReversed: () => void }) {
  const [preview, setPreview] = useState<Preview>();
  const [message, setMessage] = useState<{ text: string; href?: string }>();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const locked = useRef(false);
  const requestId = useRef<string>(undefined);

  async function run(confirm: boolean) {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setMessage(undefined);
    try {
      if (confirm) {
        requestId.current ??= crypto.randomUUID();
        const result = await reverseJournalAction({ entryId, scope, requestId: requestId.current });
        if (!result.ok) {
          setMessage({ text: result.message, href: "href" in result ? result.href : undefined });
          return;
        }
        setDone(true);
        onReversed();
      } else {
        const result = await previewJournalReversal({ entryId, scope });
        if (result.ok) setPreview(result);
        else setMessage({ text: result.message, href: "href" in result ? result.href : undefined });
      }
    } catch {
      setMessage({ text: "Не удалось получить ответ. Повторите запрос" });
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  if (done) return <p role="status">Действие отменено</p>;
  return <div className="space-y-2">
    {preview ? <p>Отменить действие «{preview.actionLabel}» для «{preview.entityLabel}»?</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant={preview ? "destructive" : "outline"} disabled={pending} onClick={() => void run(Boolean(preview))}>
        {preview ? "Подтвердить откат" : "Откат действия"}
      </Button>
      {preview ? <Button type="button" variant="ghost" disabled={pending} onClick={() => { setPreview(undefined); setMessage(undefined); }}>
        Закрыть подтверждение
      </Button> : null}
    </div>
    {message ? <p role="alert">{message.text} {message.href ? <a href={message.href} className="underline">{message.href.startsWith("/changelog?") ? "Открыть историю в Журнале" : "Открыть связанную запись"}</a> : null}</p> : null}
  </div>;
}
