"use client";

import { useEffect, useRef, useState, type ReactNode, type KeyboardEvent } from "react";

import { useKanbanSearchFocus, type KanbanSearchFocus } from "@/hooks/use-kanban-search-focus";

type ScrollMetrics = { width: number; maximum: number; step: number };
export function KanbanScrollArea({ children, label, searchFocus }: { children: ReactNode; label: string; searchFocus?: KanbanSearchFocus }) {
  const boardRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useKanbanSearchFocus(boardRef, searchFocus);
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<ScrollMetrics>({ width: 0, maximum: 0, step: 256 });
  useEffect(() => {
    const board = boardRef.current, content = contentRef.current;
    if (!board || !content) return;
    function measure() {
      if (!board || !content) return;
      const column = content.firstElementChild;
      const gap = Number.parseFloat(getComputedStyle(content).columnGap) || 0;
      const next = { width: board.scrollWidth, maximum: Math.max(0, board.scrollWidth - board.clientWidth), step: (column?.getBoundingClientRect().width ?? 256) + gap };
      setMetrics(previous => previous.width === next.width && previous.maximum === next.maximum && previous.step === next.step ? previous : next);
    }
    function wheel(event: WheelEvent) {
      if (!board || !event.shiftKey || event.deltaX !== 0 || event.deltaY === 0) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? board.clientWidth : 1;
      board.scrollLeft += event.deltaY * unit;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(board); observer.observe(content);
    board.addEventListener("wheel", wheel, { passive: false });
    measure();
    return () => { observer.disconnect(); board.removeEventListener("wheel", wheel); };
  }, []);
  useEffect(() => {
    const board = boardRef.current, scrollbar = scrollbarRef.current;
    if (board && scrollbar) scrollbar.scrollLeft = board.scrollLeft;
  }, [metrics.width, metrics.maximum]);
  function synchronize(source: HTMLDivElement, target: HTMLDivElement | null) {
    if (target && Math.abs(target.scrollLeft - source.scrollLeft) > 0.5) target.scrollLeft = source.scrollLeft;
  }
  function scrollByColumn(direction: -1 | 1) {
    const board = boardRef.current;
    if (board) board.scrollBy({ left: direction * metrics.step, behavior: "instant" });
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); scrollByColumn(event.key === "ArrowLeft" ? -1 : 1); }
    else if (event.key === "Home" || event.key === "End") { event.preventDefault(); boardRef.current?.scrollTo({ left: event.key === "Home" ? 0 : metrics.maximum, behavior: "instant" }); }
  }
  return <div className="min-w-0 max-w-full" data-kanban-scroll-area>
    <div ref={boardRef} data-slot="kanban-scroll" role="region" aria-label={label} tabIndex={0} className="min-w-0 max-w-full overflow-x-auto pb-4"
      style={{ scrollbarWidth: "none" }} onScroll={event => synchronize(event.currentTarget, scrollbarRef.current)} onKeyDown={navigate}>
      <div ref={contentRef} data-kanban-columns className="flex w-max min-w-full gap-3">{children}</div>
    </div>
    {metrics.maximum > 0 ? <div ref={scrollbarRef} data-kanban-scrollbar role="region" aria-label={`${label}: горизонтальная прокрутка`} tabIndex={0}
      className="sticky bottom-0 z-20 min-w-0 max-w-full overflow-x-auto overflow-y-hidden bg-background"
      onScroll={event => synchronize(event.currentTarget, boardRef.current)} onKeyDown={navigate}>
      <div aria-hidden="true" style={{ width: metrics.width, height: 1 }} />
    </div> : null}
  </div>;
}
