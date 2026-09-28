"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, FolderKanban, Package, Search, User, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchResults {
  projects: {
    id: string;
    number: string;
    title: string;
    client: string;
    stage: string;
  }[];
  products: {
    id: string;
    number: string;
    title: string;
    status: string;
    projectNumber: string;
    client: string;
  }[];
  tasks: {
    id: string;
    title: string;
    status: string;
    projectId: string;
    projectNumber: string;
    projectTitle: string;
    productId: string | null;
    productNumber: string | null;
    assignee: string | null;
  }[];
  clients: { id: string; name: string; phone: string }[];
}

interface FlatItem {
  key: string;
  group: "Проекты" | "Изделия" | "Задачи" | "Клиенты";
  icon: "project" | "product" | "task" | "client";
  title: string;
  hint: string;
  href: string;
}

// Глобальный поиск (omnisearch, как в IDE): Ctrl+K / поле в шапке —
// палитра со всеми совпадениями: проекты, задачи, клиенты.
export function Omnisearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [active, setActive] = useState(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ctrl+K / Cmd+K открывает палитру
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const search = useCallback((q: string) => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      if (q.trim().length < 2) {
        setResults(null);
        return;
      }
      const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (response.ok) {
        setResults(await response.json());
        setActive(0);
      }
    }, 250);
  }, []);

  const flat: FlatItem[] = results
    ? [
        ...results.projects.map((project) => ({
          key: `p-${project.id}`,
          group: "Проекты" as const,
          icon: "project" as const,
          title: `${project.number} · ${project.title}`,
          hint: project.client,
          href: `/projects/${project.id}`,
        })),
        ...(results.products ?? []).map((product) => ({
          key: `pr-${product.id}`,
          group: "Изделия" as const,
          icon: "product" as const,
          title: `${product.number} · ${product.title}`,
          hint: `${product.projectNumber} · ${product.client}`,
          href: `/products/${product.number}`,
        })),
        ...results.tasks.map((task) => ({
          key: `t-${task.id}`,
          group: "Задачи" as const,
          icon: "task" as const,
          title: task.title,
          hint: `${task.projectNumber}${task.productNumber ? ` · ${task.productNumber}` : ""} · ${task.assignee ?? ""}`,
          href: task.productNumber
            ? `/products/${task.productNumber}`
            : `/projects/${task.projectId}`,
        })),
        ...results.clients.map((client) => ({
          key: `c-${client.id}`,
          group: "Клиенты" as const,
          icon: "client" as const,
          title: client.name,
          hint: client.phone,
          href: "/clients",
        })),
      ]
    : [];

  function go(item: FlatItem) {
    setOpen(false);
    setQuery("");
    setResults(null);
    router.push(item.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((prev) => Math.min(prev + 1, flat.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((prev) => Math.max(prev - 1, 0));
    } else if (event.key === "Enter" && flat[active]) {
      event.preventDefault();
      go(flat[active]);
    }
  }

  const icons = {
    project: <FolderKanban className="size-4 shrink-0 text-muted-foreground" />,
    product: <Package className="size-4 shrink-0 text-muted-foreground" />,
    task: <ClipboardList className="size-4 shrink-0 text-muted-foreground" />,
    client: <User className="size-4 shrink-0 text-muted-foreground" />,
  };

  let lastGroup = "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Глобальный поиск"
        className="flex size-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-background text-sm text-muted-foreground transition-colors hover:bg-accent md:h-8 md:w-56 md:border md:px-2.5"
      >
        <Search className="size-4" />
        <span className="hidden flex-1 truncate text-left md:block">Поиск…</span>
        <kbd className="hidden rounded border bg-muted px-1 text-[10px] md:inline">
          Ctrl K
        </kbd>
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setQuery("");
            setResults(null);
          }
        }}
      >
        <DialogContent
          className="max-w-xl gap-0 p-0 md:top-24 md:translate-y-0 md:overflow-hidden"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Глобальный поиск</DialogTitle>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                search(event.target.value);
              }}
              onKeyDown={onInputKeyDown}
              placeholder="Проект, изделие, задача, клиент…"
              className="border-0 shadow-none focus-visible:ring-0"
            />
            <button
              type="button"
              aria-label="Закрыть"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto p-1.5">
            {flat.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                {query.trim().length < 2
                  ? "Введите минимум 2 символа"
                  : "Совпадений не найдено"}
              </div>
            ) : (
              flat.map((item, index) => {
                const groupHeader =
                  item.group !== lastGroup ? (
                    <div
                      key={`h-${item.group}`}
                      className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                    >
                      {item.group}
                    </div>
                  ) : null;
                lastGroup = item.group;
                return (
                  <div key={item.key}>
                    {groupHeader}
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm",
                        index === active ? "bg-accent" : "hover:bg-accent/60",
                      )}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => go(item)}
                    >
                      {icons[item.icon]}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.hint}
                        </span>
                      </span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <div className="border-t px-3 py-1.5 text-xs text-muted-foreground">
            ↑↓ — выбор · Enter — открыть · Esc — закрыть
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
