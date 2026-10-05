"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

type ScrollMetrics = { maximum: number; position: number; step: number };
export function KanbanScrollArea({ children, label }: { children: ReactNode; label: string }) {
  const boardRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<ScrollMetrics>({ maximum: 0, position: 0, step: 256 });
  useEffect(() => {
    const board = boardRef.current, content = contentRef.current;
    if (!board || !content) return;
    function measure() {
      if (!board || !content) return;
      const column = content.firstElementChild;
      const gap = Number.parseFloat(getComputedStyle(content).columnGap) || 0;
      const next = { maximum: Math.max(0, board.scrollWidth - board.clientWidth), position: board.scrollLeft, step: (column?.getBoundingClientRect().width ?? 256) + gap };
      setMetrics(previous => previous.maximum === next.maximum && previous.position === next.position && previous.step === next.step ? previous : next);
    }
    function wheel(event: WheelEvent) {
      if (!board || !event.shiftKey || event.deltaX !== 0 || event.deltaY === 0) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? board.clientWidth : 1;
      board.scrollLeft += event.deltaY * unit;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(board); observer.observe(content);
    board.addEventListener("scroll", measure, { passive: true });
    board.addEventListener("wheel", wheel, { passive: false });
    measure();
    return () => { observer.disconnect(); board.removeEventListener("scroll", measure); board.removeEventListener("wheel", wheel); };
  }, []);
  function scrollByColumn(direction: -1 | 1) {
    const board = boardRef.current;
    if (board) board.scrollBy({ left: direction * metrics.step, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  return <div className="min-w-0 max-w-full" data-kanban-scroll-area>
    {metrics.maximum > 0 ? <div data-kanban-navigation className="sticky top-2 z-20 mb-2 flex min-w-0 items-center gap-2 rounded-lg border bg-background/95 p-2 shadow-sm">
      <Button type="button" variant="outline" size="icon" aria-label={`${label}: прокрутить влево`} disabled={metrics.position <= 1} onClick={() => scrollByColumn(-1)}><ChevronLeft className="size-4" /></Button>
      <input data-kanban-scrollbar type="range" min={0} max={metrics.maximum} step={1} value={metrics.position}
        aria-label={`${label}: горизонтальная прокрутка`}
        aria-valuetext={metrics.position <= 1 ? "Начало доски" : metrics.position >= metrics.maximum - 1 ? "Конец доски" : `Колонка ${Math.floor(metrics.position / metrics.step) + 1}`}
        className="h-11 min-w-0 flex-1 cursor-ew-resize accent-primary md:h-5"
        onChange={event => {
          const position = Number(event.currentTarget.value);
          setMetrics(previous => ({ ...previous, position }));
          boardRef.current?.scrollTo({ left: position, behavior: "instant" });
        }} />
      <Button type="button" variant="outline" size="icon" aria-label={`${label}: прокрутить вправо`} disabled={metrics.position >= metrics.maximum - 1} onClick={() => scrollByColumn(1)}><ChevronRight className="size-4" /></Button>
    </div> : null}
    <div ref={boardRef} data-slot="kanban-scroll" role="region" aria-label={label} tabIndex={0} className="min-w-0 max-w-full overflow-x-auto pb-4"
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); scrollByColumn(event.key === "ArrowLeft" ? -1 : 1); }
        else if (event.key === "Home" || event.key === "End") { event.preventDefault(); event.currentTarget.scrollTo({ left: event.key === "Home" ? 0 : metrics.maximum, behavior: "instant" }); }
      }}>
      <div ref={contentRef} data-kanban-columns className="flex w-max min-w-full gap-3">{children}</div>
    </div>
  </div>;
}
