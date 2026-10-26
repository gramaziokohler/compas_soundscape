import { useEffect, useState, type RefObject } from 'react';

/** Tracks the content-box size (CSS px) of an element; {0,0} until measured. */
export function useElementSize(ref: RefObject<HTMLElement | null>, enabled = true): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const update = () => {
      const w = Math.floor(el.clientWidth);
      const h = Math.floor(el.clientHeight);
      setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled]);

  return size;
}
