const active = new WeakMap<HTMLElement, () => void>();

/** Возвращаем snap перед ручным жестом, чтобы браузер не отменил точную позицию. */
export function suspendKanbanSnap(board: HTMLElement): () => void {
  active.get(board)?.();
  if (getComputedStyle(board).scrollSnapType === "none") return () => {};
  const previous = board.style.getPropertyValue("scroll-snap-type");
  const priority = board.style.getPropertyPriority("scroll-snap-type");
  board.style.setProperty("scroll-snap-type", "none");
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    if (previous) board.style.setProperty("scroll-snap-type", previous, priority);
    else board.style.removeProperty("scroll-snap-type");
    window.removeEventListener("wheel", restore);
    window.removeEventListener("touchmove", restore);
    window.removeEventListener("pointerdown", pointer);
    window.removeEventListener("keydown", keyboard);
    active.delete(board);
  };
  const pointer = (event: PointerEvent) => {
    // Обычный клик по карточке не является прокруткой: snap перед переходом
    // сдвинул бы её относительно положения, которое пользователь оставил.
    if (event.target instanceof Element && event.target.closest("[data-kanban-card-id]")) return;
    restore();
  };
  const keyboard = (event: KeyboardEvent) => {
    if (event.target instanceof Element && event.target.closest("[data-kanban-scroll-area]")
      && ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", " "].includes(event.key)) restore();
  };
  active.set(board, restore);
  window.addEventListener("wheel", restore, { passive: true, once: true });
  window.addEventListener("touchmove", restore, { passive: true, once: true });
  window.addEventListener("pointerdown", pointer);
  window.addEventListener("keydown", keyboard);
  return restore;
}
