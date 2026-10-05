"use client";

import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { containedImageBounds, type ImageBounds } from "@/lib/contained-image-bounds";
import { cn } from "@/lib/utils";

type Props = ComponentProps<"div"> & { imageKey: string | null };

/** Меняется только рамка: img, его контейнер и интерактивные элементы остаются на месте. */
export function ContainImageFrame({ imageKey, children, className, onLoadCapture, onErrorCapture, ...props }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const refresh = useRef<() => void>(() => {});
  const [measured, setMeasured] = useState<{ key: string | null; bounds: ImageBounds | null }>({ key: null, bounds: null });
  const bounds = measured.key === imageKey ? measured.bounds : null;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    function measure() {
      if (!host) return;
      const image = host.querySelector("img");
      let next: ImageBounds | null = null;
      if (image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
        const hostBox = host.getBoundingClientRect();
        const imageBox = image.getBoundingClientRect();
        const style = getComputedStyle(image);
        const padding = (name: "paddingLeft" | "paddingRight" | "paddingTop" | "paddingBottom") => Number.parseFloat(style[name]) || 0;
        next = containedImageBounds({
          left: imageBox.left - hostBox.left - host.clientLeft + image.clientLeft + padding("paddingLeft"),
          top: imageBox.top - hostBox.top - host.clientTop + image.clientTop + padding("paddingTop"),
          width: image.clientWidth - padding("paddingLeft") - padding("paddingRight"),
          height: image.clientHeight - padding("paddingTop") - padding("paddingBottom"),
        }, image.naturalWidth, image.naturalHeight);
      }
      setMeasured(previous => previous.key === imageKey && JSON.stringify(previous.bounds) === JSON.stringify(next) ? previous : { key: imageKey, bounds: next });
    }
    refresh.current = measure;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    const image = host.querySelector("img");
    if (image) observer.observe(image);
    measure();
    return () => {
      observer.disconnect();
      refresh.current = () => {};
    };
  }, [imageKey, children]);

  return <div {...props} ref={hostRef} className={cn(className, bounds && "border-transparent bg-transparent")} data-fitted-image-frame={bounds ? "fitted" : "original"}
    onLoadCapture={event => { onLoadCapture?.(event); refresh.current(); }}
    onErrorCapture={event => { onErrorCapture?.(event); setMeasured({ key: imageKey, bounds: null }); }}>
    {children}
    {bounds ? <div data-image-border aria-hidden="true" className="pointer-events-none absolute rounded-lg border" style={bounds} /> : null}
  </div>;
}
