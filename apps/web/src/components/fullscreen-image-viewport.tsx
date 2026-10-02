"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { beginImageGesture, clampImageTransform, fitImage, imageGesture, initialImageTransform, zoomImageAt, IMAGE_MAX_SCALE, type ImageBounds, type ImagePoint, type ImageSize, type ImageTransform } from "@/lib/image-view-transform";

/** Все движения ограничены поверхностью изображения; фон блокирует modal Dialog. */
export function FullscreenImageViewport({ src, alt }: { src: string; alt: string }) {
  const surface = useRef<HTMLDivElement>(null);
  const natural = useRef<ImageSize>({width:0,height:0});
  const bounds = useRef<ImageBounds>({viewport:{width:0,height:0},image:{width:0,height:0}});
  const current = useRef(initialImageTransform());
  const pointers = useRef(new Map<number,ImagePoint>());
  const gesture = useRef<ReturnType<typeof beginImageGesture>>(null);
  const [transform,setTransform] = useState(initialImageTransform);
  const [failed,setFailed] = useState(false);
  function update(value: ImageTransform) { current.current=value; setTransform(value); }
  function measure() {
    const node=surface.current;
    if (!node) return;
    bounds.current={viewport:{width:node.clientWidth,height:node.clientHeight},image:fitImage(natural.current,{width:node.clientWidth,height:node.clientHeight})};
    update(clampImageTransform(current.current,bounds.current));
    // Перемена viewport завершает старый жест, не меняя координаты страницы.
    pointers.current.clear(); gesture.current=null;
  }
  useEffect(() => {
    const node=surface.current;
    if (!node) return;
    const activePointers=pointers.current;
    measure();
    const observer=new ResizeObserver(measure); observer.observe(node);
    function wheel(event: WheelEvent) {
      event.preventDefault();
      if (!bounds.current.image.width) return;
      const rect=node!.getBoundingClientRect();
      const anchor={x:event.clientX-rect.left-rect.width/2,y:event.clientY-rect.top-rect.height/2};
      const unit=event.deltaMode===1 ? 16 : event.deltaMode===2 ? rect.height : 1;
      const factor=Math.exp(-Math.max(-1000,Math.min(1000,event.deltaY*unit))*0.002);
      update(zoomImageAt(current.current,current.current.scale*factor,anchor,bounds.current));
      gesture.current=beginImageGesture([...pointers.current.values()],current.current);
    }
    node.addEventListener("wheel",wheel,{passive:false});
    return () => { observer.disconnect(); node.removeEventListener("wheel",wheel); activePointers.clear(); gesture.current=null; };
    // Поверхность имеет keyed lifecycle по файлу; callbacks читают актуальные refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function point(event: { clientX: number; clientY: number; currentTarget: HTMLDivElement }): ImagePoint {
    const rect=event.currentTarget.getBoundingClientRect();
    return {x:event.clientX-rect.left-rect.width/2,y:event.clientY-rect.top-rect.height/2};
  }
  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType==="mouse"&&event.button!==0) return;
    if (!bounds.current.image.width) return;
    event.preventDefault(); event.currentTarget.focus({preventScroll:true});
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId,point(event));
    gesture.current=beginImageGesture([...pointers.current.values()],current.current);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)||!gesture.current) return;
    event.preventDefault(); pointers.current.set(event.pointerId,point(event));
    update(imageGesture(gesture.current,[...pointers.current.values()],bounds.current));
  }
  function end(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    gesture.current=beginImageGesture([...pointers.current.values()],current.current);
  }
  function zoom(factor: number) { update(zoomImageAt(current.current,current.current.scale*factor,{x:0,y:0},bounds.current)); gesture.current=beginImageGesture([...pointers.current.values()],current.current); }
  function reset() { update(initialImageTransform()); pointers.current.clear(); gesture.current=null; }
  return <div className="relative h-full min-h-0 w-full min-w-0" data-fullscreen-image>
    <div ref={surface} role="region" aria-label="Изображение: масштаб и перемещение" tabIndex={0}
      className="absolute inset-0 touch-none overflow-hidden overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
      style={{cursor:transform.scale>1?"grab":"zoom-in"}}
      onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
      onDoubleClick={event=>{event.preventDefault();update(zoomImageAt(current.current,current.current.scale>1?1:2,point(event),bounds.current));}}
      onKeyDown={event=>{
        if (["+","=","-","0","ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)) event.preventDefault();
        if (event.key==="+"||event.key==="=") zoom(1.5);
        else if (event.key==="-") zoom(1/1.5);
        else if (event.key==="0") reset();
        else if (event.key.startsWith("Arrow")) update(clampImageTransform({...current.current,x:current.current.x+(event.key==="ArrowLeft"?40:event.key==="ArrowRight"?-40:0),y:current.current.y+(event.key==="ArrowUp"?40:event.key==="ArrowDown"?-40:0)},bounds.current));
      }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} draggable={false} className="h-full w-full select-none object-contain"
        style={{transform:`translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,transformOrigin:"center"}}
        onLoad={event=>{natural.current={width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight};setFailed(false);measure();}}
        onError={()=>setFailed(true)} />
      {failed?<p role="alert" className="absolute inset-0 flex items-center justify-center p-4 text-center text-white">Не удалось загрузить изображение</p>:null}
    </div>
    <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg bg-black/70 p-1" role="group" aria-label="Масштаб изображения">
      <button type="button" className="inline-flex size-11 items-center justify-center rounded-md hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40" aria-label="Уменьшить изображение" disabled={transform.scale<=1} onClick={()=>zoom(1/1.5)}><Minus className="size-5" /></button>
      <span aria-live="polite" className="min-w-12 text-center text-sm tabular-nums">{Math.round(transform.scale*100)}%</span>
      <button type="button" className="inline-flex size-11 items-center justify-center rounded-md hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40" aria-label="Увеличить изображение" disabled={transform.scale>=IMAGE_MAX_SCALE} onClick={()=>zoom(1.5)}><Plus className="size-5" /></button>
      <button type="button" className="inline-flex size-11 items-center justify-center rounded-md hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white" aria-label="Показать изображение целиком" onClick={reset}><RotateCcw className="size-5" /></button>
    </div>
  </div>;
}
