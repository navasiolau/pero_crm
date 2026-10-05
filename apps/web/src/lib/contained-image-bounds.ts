export type ImageBounds = { left: number; top: number; width: number; height: number };

/** Фактическая область object-contain при прежнем центрировании изображения. */
export function containedImageBounds(box: ImageBounds, naturalWidth: number, naturalHeight: number): ImageBounds | null {
  if (![box.left, box.top, box.width, box.height, naturalWidth, naturalHeight].every(Number.isFinite) ||
    box.width <= 0 || box.height <= 0 || naturalWidth <= 0 || naturalHeight <= 0) return null;
  const scale = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}
