export type ImagePoint = { x: number; y: number };
export type ImageSize = { width: number; height: number };
export type ImageTransform = ImagePoint & { scale: number };
export type ImageBounds = { viewport: ImageSize; image: ImageSize };
export const IMAGE_MAX_SCALE = 8;
export const initialImageTransform = (): ImageTransform => ({ scale: 1, x: 0, y: 0 });
const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
const limit = (value: number, max: number) => max > 0 ? Math.max(-max, Math.min(max, finite(value))) : 0;
export function fitImage(image: ImageSize, viewport: ImageSize): ImageSize {
  if (![image.width,image.height,viewport.width,viewport.height].every(value => Number.isFinite(value) && value > 0)) return {width:0,height:0};
  const ratio = Math.min(viewport.width / image.width, viewport.height / image.height);
  return {width:image.width * ratio,height:image.height * ratio};
}
export function clampImageTransform(value: ImageTransform, bounds: ImageBounds): ImageTransform {
  const scale = Math.max(1, Math.min(IMAGE_MAX_SCALE, finite(value.scale, 1)));
  const maxX = Math.max(0,(bounds.image.width * scale - bounds.viewport.width) / 2);
  const maxY = Math.max(0,(bounds.image.height * scale - bounds.viewport.height) / 2);
  return {scale,x:limit(value.x,maxX),y:limit(value.y,maxY)};
}
export function zoomImageAt(value: ImageTransform, target: number, anchor: ImagePoint, bounds: ImageBounds): ImageTransform {
  const scale = Math.max(1,Math.min(IMAGE_MAX_SCALE,finite(target,1)));
  const ratio = scale / value.scale;
  return clampImageTransform({scale,x:anchor.x-(anchor.x-value.x)*ratio,y:anchor.y-(anchor.y-value.y)*ratio},bounds);
}
type ImageGesture = { transform: ImageTransform; center: ImagePoint; distance: number; pointers: number };
const center = (points: ImagePoint[]): ImagePoint => points.length > 1 ? {x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2} : points[0];
const distance = (points: ImagePoint[]) => points.length > 1 ? Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y) : 0;
export function beginImageGesture(points: ImagePoint[], transform: ImageTransform): ImageGesture | null {
  if (!points.length) return null;
  return {transform:{...transform},center:{...center(points)},distance:distance(points),pointers:Math.min(points.length,2)};
}
export function imageGesture(gesture: ImageGesture, points: ImagePoint[], bounds: ImageBounds): ImageTransform {
  if (!points.length) return clampImageTransform(gesture.transform,bounds);
  const now = center(points);
  const ratio = gesture.pointers === 2 && points.length > 1 && gesture.distance > 0 ? distance(points) / gesture.distance : 1;
  const zoomed = zoomImageAt(gesture.transform,gesture.transform.scale * ratio,gesture.center,bounds);
  return clampImageTransform({...zoomed,x:zoomed.x+now.x-gesture.center.x,y:zoomed.y+now.y-gesture.center.y},bounds);
}
