"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Power } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { addExpenseArticle, toggleExpenseArticle } from "@/server/finance/actions";
import type { ExpenseArticleView } from "@/server/finance/queries";
import { nextExpenseArticleCode, parseExpenseArticleCode } from "@/lib/expense-article-code";

// Статьи расходов (§8/§11): справочник для расходов по проектам.
// Статья с историей операций не удаляется — деактивируется.
export function ArticlesView({ articles }: { articles: ExpenseArticleView[] }) {
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function openAdd() {
    setError(null);
    try { setCode(String(nextExpenseArticleCode(articles.length ? Math.max(...articles.map(article => article.code)) : null))); }
    catch { setCode(""); setError("Автоматические коды закончились. Укажите свободный положительный код"); }
    setAddOpen(true);
  }

  const columns: DataColumn<ExpenseArticleView>[] = [
    { id: "code", header: "Код", sortable: true, sortValue: row => row.code,
      cell: row => <span className={cn("tabular-nums", !row.active && "text-muted-foreground")}>{row.code}</span> },
    {
      id: "name",
      header: "Название",
      sortable: true,
      sortValue: (row) => row.name,
      cell: (row) => (
        <span className={cn(!row.active && "text-muted-foreground line-through")}>
          {row.name}
        </span>
      ),
    },
    {
      id: "comment",
      header: "Комментарий",
      sortable: true,
      sortValue: (row) => row.comment ?? "",
      cell: (row) => (
        <span className="text-muted-foreground">{row.comment ?? "—"}</span>
      ),
    },
    {
      id: "status",
      header: "Статус",
      sortable: true,
      sortValue: (row) => (row.active ? 1 : 0),
      cell: (row) =>
        row.active ? (
          <Badge variant="outline">Активна</Badge>
        ) : (
          <Badge variant="secondary">Неактивна</Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      className: "w-10",
      cell: (row) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label={row.active ? "Деактивировать статью" : "Активировать статью"}
          disabled={pending}
          onClick={(event) => {
            event.stopPropagation();
            startTransition(async () => {
              const result = await toggleExpenseArticle(row.id);
              if (result.ok) {
                toast.success(
                  row.active ? "Статья деактивирована" : "Статья активирована",
                );
              } else {
                toast.error(result.error ?? "Ошибка");
              }
            });
          }}
        >
          <Power className="size-4 text-muted-foreground" />
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Статьи расходов</h1>
          <p className="text-sm text-muted-foreground">
            Зарплата статьёй не нужна — она учитывается из начислений по задачам
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="size-4" />
          Добавить статью
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={articles}
        searchPlaceholder="Поиск по статьям…"
        emptyText="Статей пока нет — добавьте первую"
      />

      <Dialog
        open={addOpen}
        onOpenChange={(next) => {
          if (!next) {
            setName("");
            setComment("");
            setCode("");
            setError(null);
          }
          setAddOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая статья расхода</DialogTitle>
            <DialogDescription>
              Будет доступна при внесении расходов по проектам
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="article-code">Код *</Label>
              <Input id="article-code" inputMode="numeric" pattern="[0-9]*" maxLength={10}
                value={code} aria-invalid={Boolean(error)} onChange={event => {
                  if (/^[0-9]*$/.test(event.target.value)) { setCode(event.target.value); setError(null); }
                }} />
              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="article-name">Название *</Label>
              <Input
                id="article-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Материалы, Логистика, Прочее…"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="article-comment">Комментарий</Label>
              <Input
                id="article-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Необязательно"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Отмена
            </Button>
            <Button
              disabled={pending || name.trim() === ""}
              onClick={() =>
                startTransition(async () => {
                  try { parseExpenseArticleCode(code); }
                  catch (failure) { setError(failure instanceof Error ? failure.message : "Проверьте код"); return; }
                  const result = await addExpenseArticle({
                    code,
                    name: name.trim(),
                    comment: comment.trim() || undefined,
                  });
                  if (result.ok) {
                    toast.success("Статья создана");
                    setAddOpen(false);
                    setName("");
                    setComment("");
                    setCode("");
                    setError(null);
                  } else {
                    setError(result.error ?? "Ошибка");
                    toast.error(result.error ?? "Ошибка");
                  }
                })
              }
            >
              {pending ? "Сохранение…" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
