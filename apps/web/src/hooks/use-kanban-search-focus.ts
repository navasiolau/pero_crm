"use client";

import { useEffect, useRef, type RefObject } from "react";
import { suspendKanbanSnap } from "@/lib/kanban-scroll-snap";

export interface KanbanSearchFocus {
  query: string;
  cardId: string | null;
  ready: boolean;
}

const clamp = (value: number, maximum: number) => Math.max(0, Math.min(maximum, value));

/** Один переход для нового поискового текста; новые массивы/SSE его не повторяют. */
export function useKanbanSearchFocus(boardRef: RefObject<HTMLDivElement | null>, focus?: KanbanSearchFocus, handledSearch?: RefObject<string | null>) {
  const query = focus?.query.trim() ?? "";
  const request = useRef({ query: "", done: false });
  const restoreSnap = useRef<(() => void) | null>(null);

  useEffect(() => {
    request.current = { query, done: !query };
    return () => { restoreSnap.current?.(); };
  }, [query]);

  useEffect(() => {
    if (!query || !focus?.ready || request.current.done) return;
    if (handledSearch?.current === query) { request.current.done = true; return; }
    // Отсутствие точного совпадения также потребляет запрос: последующий SSE
    // не должен неожиданно отбирать ручную позицию прокрутки.
    if (!focus.cardId) { request.current.done = true; return; }
    const cardId = focus.cardId;
    let frame = 0;
    let observedCard: HTMLElement | undefined;
    const resize = new ResizeObserver(schedule);
    const mutations = new MutationObserver(schedule);
    function disconnect() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(center);
    }
    function center() {
      frame = 0;
      const board = boardRef.current;
      if (!board || request.current.query !== query || request.current.done) return;
      if (handledSearch?.current === query) { request.current.done = true; disconnect(); return; }
      const card = Array.from(board.querySelectorAll<HTMLElement>("[data-kanban-card-id]"))
        .find(item => item.dataset.kanbanCardId === cardId);
      if (card !== observedCard) {
        if (observedCard) resize.unobserve(observedCard);
        observedCard = card;
        if (card) resize.observe(card);
      }
      const bounds = board.getBoundingClientRect(), target = card?.getBoundingClientRect();
      // Подтверждённые данные могут опередить вставку или измеримый layout.
      // DOM/resize-событие продолжит тот же запрос без постоянного RAF polling.
      if (!target || target.width <= 0 || target.height <= 0 || bounds.width <= 0 || bounds.height <= 0) return;
      request.current.done = true;
      disconnect();

      restoreSnap.current?.();
      restoreSnap.current = suspendKanbanSnap(board);

      const visibleCenter = (Math.max(0, bounds.left) + Math.min(window.innerWidth, bounds.right)) / 2;
      const left = clamp(board.scrollLeft + target.left + target.width / 2 - visibleCenter,
        board.scrollWidth - board.clientWidth);
      const top = clamp(window.scrollY + target.top + target.height / 2 - window.innerHeight / 2,
        (document.scrollingElement?.scrollHeight ?? 0) - window.innerHeight);
      // Мгновенный переход сохраняет caret и также соблюдает reduced motion.
      board.scrollTo({ left, behavior: "instant" });
      window.scrollTo({ left: window.scrollX, top, behavior: "instant" });
    }
    const board = boardRef.current;
    if (board) {
      resize.observe(board);
      mutations.observe(board, { childList: true, subtree: true });
    }
    schedule();
    return disconnect;
  }, [boardRef, query, focus?.cardId, focus?.ready, handledSearch]);
}
