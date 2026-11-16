"use client";

import { useCallback, useLayoutEffect, useRef, type MouseEvent, type RefObject } from "react";
import { readKanbanPosition, writeKanbanPosition, type KanbanPosition } from "@/lib/kanban-position";
import { suspendKanbanSnap } from "@/lib/kanban-scroll-snap";
import { reflectKanbanScroll } from "@/lib/kanban-scroll-sync";
import type { ListSection } from "@/lib/list-state";

export interface KanbanScrollContext {
  userId: string;
  section: ListSection;
  query: string;
  searchText: string;
  searchRevision: number;
  ready: boolean;
  cardIds: readonly string[];
}

const clamp = (value: number, maximum: number) => Math.max(0, Math.min(value, maximum));
const stamp = (context: KanbanScrollContext) => `${context.query}\n${context.searchText.trim()}\n${context.searchRevision}`;

export function useKanbanScrollRestoration(boardRef: RefObject<HTMLDivElement | null>, context?: KanbanScrollContext) {
  const latest = useRef(context);
  const handledSearch = useRef<string | null>(null);
  const lifecycle = useRef<{ update(): void; open(id: string): void } | null>(null);
  const userId = context?.userId, section = context?.section;

  useLayoutEffect(() => { latest.current = context; });
  useLayoutEffect(() => {
    const board = boardRef.current, initial = latest.current;
    if (!board || !initial || !userId || !section) return;
    const initialStamp = stamp(initial);
    let pending = readKanbanPosition(userId, section, initial.query);
    let last: KanbanPosition | null = pending;
    let anchorId = pending?.anchor?.id ?? null;
    let frozen = false, frame = 0, captureFrame = 0, stopped = false;
    let resumeSnap = () => {};
    // Поиск не должен повторяться даже после отмены восстановления ручным жестом.
    handledSearch.current = pending ? initial.searchText.trim() : null;
    const findCard = (id: string) => Array.from(board.querySelectorAll<HTMLElement>("[data-kanban-card-id]"))
      .find(card => card.dataset.kanbanCardId === id);
    const onBoard = () => window.location.pathname === `/${section}`;

    function capture() {
      const current = latest.current;
      if (!current?.ready || !board || pending || frozen || !onBoard()) return;
      const card = anchorId ? findCard(anchorId) : null;
      const rect = card?.getBoundingClientRect();
      last = { version: 1, query: current.query, left: board.scrollLeft, top: window.scrollY,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        anchor: rect && anchorId ? { id: anchorId, x: rect.x, y: rect.y } : null };
    }
    function save() { if (last) writeKanbanPosition(userId!, section!, last); }
    function scheduleCapture() {
      if (!captureFrame) captureFrame = requestAnimationFrame(() => { captureFrame = 0; capture(); });
    }
    function stopWaiting() {
      pending = null;
      cancelAnimationFrame(frame); frame = 0;
      resize.disconnect(); mutations.disconnect(); clearTimeout(deadline);
    }
    function cancel() {
      if (!pending) return;
      stopWaiting(); scheduleCapture();
    }
    function keydown(event: KeyboardEvent) {
      if (event.target instanceof Element && event.target.closest("input,textarea,[contenteditable=true]")) return;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", " "].includes(event.key)) cancel();
    }
    function restore() {
      frame = 0;
      const current = latest.current, position = pending;
      if (!position || !current || !board || stopped || !onBoard()) return;
      if (stamp(current) !== initialStamp) { cancel(); return; }
      if (!current.ready) return;
      const bounds = board.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const card = position.anchor ? findCard(position.anchor.id) : null;
      const rect = card?.getBoundingClientRect();
      if (position.anchor && current.cardIds.includes(position.anchor.id) && (!rect || rect.width <= 0 || rect.height <= 0)) return;
      resumeSnap = suspendKanbanSnap(board);
      // Якорь сохраняет экранное место карточки и при новых строках/статусе.
      const anchorX = position.anchor && rect ? position.viewport.width === window.innerWidth ? position.anchor.x : clamp(position.anchor.x, Math.max(0, window.innerWidth - rect.width)) : 0;
      const anchorY = position.anchor && rect ? position.viewport.height === window.innerHeight ? position.anchor.y : clamp(position.anchor.y, Math.max(0, window.innerHeight - rect.height)) : 0;
      const wantedX = rect && position.anchor ? board.scrollLeft + rect.x - anchorX : position.left;
      const wantedY = rect && position.anchor ? window.scrollY + rect.y - anchorY : position.top;
      board.scrollTo({ left: clamp(wantedX, board.scrollWidth - board.clientWidth), behavior: "instant" });
      window.scrollTo({ left: window.scrollX, top: clamp(wantedY, (document.scrollingElement?.scrollHeight ?? 0) - window.innerHeight), behavior: "instant" });
      const scrollbar = board.closest("[data-kanban-scroll-area]")?.querySelector<HTMLElement>("[data-kanban-scrollbar]");
      reflectKanbanScroll(scrollbar, board.scrollLeft);
      stopWaiting(); capture();
    }
    function schedule() { if (pending && !frame) frame = requestAnimationFrame(restore); }
    const resize = new ResizeObserver(schedule);
    const mutations = new MutationObserver(schedule);
    // Таймер только завершает ожидание; он не задаёт момент прокрутки.
    const deadline = setTimeout(cancel, 5000);
    if (pending) {
      resize.observe(board);
      if (board.firstElementChild) resize.observe(board.firstElementChild);
      mutations.observe(board, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
      schedule();
    } else { clearTimeout(deadline); scheduleCapture(); }

    lifecycle.current = {
      update() {
        const current = latest.current;
        if (current && stamp(current) !== initialStamp) { handledSearch.current = null; cancel(); }
        schedule();
        if (!pending) scheduleCapture();
      },
      open(id) {
        cancel(); anchorId = id; capture(); save(); frozen = true;
      },
    };
    window.addEventListener("scroll", scheduleCapture, { passive: true });
    board.addEventListener("scroll", scheduleCapture, { passive: true });
    window.addEventListener("wheel", cancel, { passive: true });
    window.addEventListener("touchstart", cancel, { passive: true });
    window.addEventListener("pointerdown", cancel, { passive: true });
    window.addEventListener("keydown", keydown);
    window.addEventListener("pagehide", save);
    return () => {
      stopped = true;
      // Не читать DOM: Next уже мог сбросить вертикаль новой страницы.
      save(); stopWaiting(); cancelAnimationFrame(captureFrame); resumeSnap();
      lifecycle.current = null; handledSearch.current = null;
      window.removeEventListener("scroll", scheduleCapture);
      board.removeEventListener("scroll", scheduleCapture);
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
      window.removeEventListener("pointerdown", cancel);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("pagehide", save);
    };
  }, [boardRef, userId, section]);
  useLayoutEffect(() => { lifecycle.current?.update(); });

  const onClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const card = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-kanban-card-id]") : null;
    if (card?.dataset.kanbanCardId && boardRef.current?.contains(card)) lifecycle.current?.open(card.dataset.kanbanCardId);
  }, [boardRef]);
  return { handledSearch, onClickCapture };
}
