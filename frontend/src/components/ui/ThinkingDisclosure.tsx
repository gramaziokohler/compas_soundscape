'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { SIMPLE_MODE } from '@/utils/constants';

/** Distance from the bottom (px) under which the box keeps following new text. */
const STICK_TO_BOTTOM_PX = 8;

export interface ThinkingDisclosureProps {
  /** Full AI thinking text streamed so far. Renders nothing when empty. */
  text: string;
  /** Height of the expanded box (px). */
  height?: number;
}

/**
 * ThinkingDisclosure Component
 *
 * Collapsed "Show thinking" toggle under a running AI step. Expanded, it shows
 * the agent's full thinking in a fixed-height scrollable box that follows the
 * stream while the user is at the bottom (scrolling up pauses the follow).
 *
 * Usage:
 * ```tsx
 * <ThinkingDisclosure text={analysisThinking} />
 * ```
 */
export function ThinkingDisclosure({ text, height = SIMPLE_MODE.THINKING_BOX_HEIGHT }: ThinkingDisclosureProps) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  useEffect(() => {
    const box = boxRef.current;
    if (open && box && followRef.current) box.scrollTop = box.scrollHeight;
  }, [open, text]);

  if (!text) return null;

  return (
    <div>
      <button
        type="button"
        className="bubble-thinking__toggle"
        onClick={() => {
          followRef.current = true;
          setOpen((v) => !v);
        }}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {open ? 'Hide thinking' : 'Show thinking'}
      </button>
      {open && (
        <div
          ref={boxRef}
          className="bubble-thinking"
          style={{ height }}
          onScroll={(e) => {
            const el = e.currentTarget;
            followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}
