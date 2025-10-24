/**
 * Horizontal Scroll Hook
 * 
 * Enables horizontal scrolling with mouse wheel in containers with horizontal overflow.
 * When scrolling vertically with the mouse wheel over a horizontally scrollable container,
 * converts the vertical wheel movement to horizontal scroll.
 * 
 * Usage:
 * ```tsx
 * const scrollRef = useHorizontalScroll<HTMLDivElement>();
 * return <div ref={scrollRef} className="overflow-x-auto">...</div>
 * ```
 */

import { useRef, useEffect } from 'react';

export function useHorizontalScroll<T extends HTMLElement>() {
  const scrollRef = useRef<T>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const handleWheel = (e: WheelEvent) => {
      // Only handle if there's horizontal overflow
      const hasHorizontalScroll = element.scrollWidth > element.clientWidth;
      if (!hasHorizontalScroll) return;

      // Only convert vertical scroll to horizontal if not already scrolling horizontally
      if (e.deltaY !== 0 && e.deltaX === 0) {
        e.preventDefault();
        element.scrollLeft += e.deltaY;
      }
    };

    element.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      element.removeEventListener('wheel', handleWheel);
    };
  }, []);

  return scrollRef;
}
