"use client";

import { useEffect, useRef, useState, useTransition, type RefObject } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseExpenseArticleCode } from "@/lib/expense-article-code";
import { addExpenseArticle } from "@/server/finance/actions";
import type { ExpenseArticleOption } from "@/server/finance/contracts";

/** Общая форма справочника и вложенного создания; денежные реквизиты остаются у родителя. */
export function ArticleDialog({ open, onOpenChange, suggestedCode = "", initialError = "", onCreated, returnFocus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestedCode?: string;
  initialError?: string;
  onCreated?: (article: ExpenseArticleOption) => void;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState(suggestedCode), [name, setName] = useState(""), [comment, setComment] = useState("");
  const [error, setError] = useState(initialError);
  const wasOpen = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setCode(suggestedCode); setName(""); setComment(""); setError(initialError);
    }
    wasOpen.current = open;
  }, [open, suggestedCode, initialError]);

  return <Dialog open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }}>
    <DialogContent finalFocus={returnFocus} showCloseButton={!pending}>
      <DialogHeader>
        <DialogTitle>Новая статья расхода</DialogTitle>
        <DialogDescription>Будет доступна при внесении расходов организации и проектов, а также закупок.</DialogDescription>
      </DialogHeader>
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="article-code">Код</Label>
          <Input id="article-code" inputMode="numeric" pattern="[0-9]*" maxLength={10} value={code} placeholder="Автоматически"
            onChange={event => { if (/^[0-9]*$/.test(event.target.value)) { setCode(event.target.value); setError(""); } }} />
          <p className="text-xs text-muted-foreground">Пусто — следующий код назначит сервер.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="article-name">Название *</Label>
          <Input id="article-name" value={name} onChange={event => setName(event.target.value)} placeholder="Материалы, Логистика, Прочее…" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="article-comment">Комментарий</Label>
          <Input id="article-comment" value={comment} onChange={event => setComment(event.target.value)} placeholder="Необязательно" />
        </div>
      </fieldset>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Отмена</Button>
        <Button disabled={pending || !name.trim()} onClick={() => startTransition(async () => {
          if (code) {
            try { parseExpenseArticleCode(code); }
            catch (failure) { setError(failure instanceof Error ? failure.message : "Проверьте код"); return; }
          }
          setError("");
          try {
            const result = await addExpenseArticle({ code: code || undefined, name: name.trim(), comment: comment.trim() || undefined });
            if (!mounted.current) return;
            if (!result.ok) { setError(result.error); return; }
            onCreated?.(result.article);
            toast.success("Статья создана"); onOpenChange(false); router.refresh();
          } catch { if (mounted.current) setError("Не удалось подтвердить создание статьи. Проверьте справочник перед повтором."); }
        })}>{pending ? "Сохранение…" : "Создать"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
