const reflectedPositions = new WeakMap<HTMLElement, number>();

/** Программное отражение не должно возвращаться в источник отложенным scroll-событием. */
export function reflectKanbanScroll(target: HTMLElement | null | undefined, left: number): void {
  if (!target || Math.abs(target.scrollLeft - left) <= 0.5) return;
  target.scrollLeft = left;
  // Браузер может округлить координату или ограничить её текущей шириной.
  reflectedPositions.set(target, target.scrollLeft);
}

export function synchronizeKanbanScroll(source: HTMLElement, target: HTMLElement | null): void {
  const reflected = reflectedPositions.get(source);
  if (reflected !== undefined && Math.abs(source.scrollLeft - reflected) <= 0.5) return;
  reflectedPositions.delete(source);
  reflectKanbanScroll(target, source.scrollLeft);
}
