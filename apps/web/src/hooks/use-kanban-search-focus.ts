"use client";

import { useEffect, useRef, type RefObject } from "react";

export interface KanbanSearchFocus {
  query: string;
  cardId: string | null;
  ready: boolean;
}

const clamp = (value: number, maximum: number) => Math.max(0, Math.min(maximum, value));

/** Один переход для нового поискового текста; новые массивы/SSE его не повторяют. */
export function useKanbanSearchFocus(boardRef: RefObject<HTMLDivElement | null>, focus?: KanbanSearchFocus) {
  const query = focus?.query.trim() ?? "";
  const request = useRef({ query: "", done: false });
  const restoreSnap = useRef<(() => void) | null>(null);

  useEffect(() => {
    request.current = { query, done: !query };
    return () => { restoreSnap.current?.(); };
  }, [query]);

  useEffect(() => {
    if (!query || !focus?.ready || request.current.done) return;
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
      if (getComputedStyle(board).scrollSnapType !== "none") {
        const previous = board.style.getPropertyValue("scroll-snap-type");
        const priority = board.style.getPropertyPriority("scroll-snap-type");
        board.style.setProperty("scroll-snap-type", "none");
        // Включение snap сразу после перехода заставляет Chrome перескочить
        // обратно к началу колонки. Вернём исходный snap перед следующим
        // ручным жестом, новым запросом или размонтированием, не меняя layout.
        const restore = () => {
          if (previous) board.style.setProperty("scroll-snap-type", previous, priority);
          else board.style.removeProperty("scroll-snap-type");
          window.removeEventListener("wheel", restore);
          window.removeEventListener("touchstart", restore);
          window.removeEventListener("pointerdown", restore);
          window.removeEventListener("keydown", keyboard);
          restoreSnap.current = null;
        };
        const keyboard = (event: KeyboardEvent) => {
          if (event.target instanceof Element && event.target.closest("[data-kanban-scroll-area]")
            && ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", " "].includes(event.key)) restore();
        };
        restoreSnap.current = restore;
        window.addEventListener("wheel", restore, { passive: true, once: true });
        window.addEventListener("touchstart", restore, { passive: true, once: true });
        window.addEventListener("pointerdown", restore, { once: true });
        window.addEventListener("keydown", keyboard);
      }

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
  }, [boardRef, query, focus?.cardId, focus?.ready]);
}
