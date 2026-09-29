'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles } from 'lucide-react';
import { FX_TYPES, FX_TYPE_LABELS, isStableAudioFx, type FxType } from '@/lib/audio/fx/fx-types';
import { DashedAddButton } from '@/components/ui/DashedAddButton';

interface FxAddMenuProps {
  onAdd: (type: FxType) => void;
}

export function FxAddMenu({ onAdd }: FxAddMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; bottom: number } | null>(null);
  const [flip, setFlip] = useState(false);

  const openMenu = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const t = trigger.getBoundingClientRect();
    // Span the full effect-list width so the badges lay out horizontally and
    // wrap — the trigger itself is only as wide as its label + plus button.
    const parent = trigger.parentElement?.getBoundingClientRect();
    setRect({
      top: t.top,
      bottom: t.bottom,
      left: parent?.left ?? t.left,
      width: parent?.width ?? t.width,
    });
    setFlip(false);
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      // The dropdown renders in a portal on document.body, so it is NOT a
      // descendant of triggerRef. Without this check the outside-mousedown
      // handler closes the menu before the item's click can fire.
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Flip above the trigger when the menu would be clipped by the bottom edge.
  useLayoutEffect(() => {
    if (!open || !menuRef.current || !rect) return;
    const h = menuRef.current.offsetHeight;
    if (rect.bottom + 4 + h > window.innerHeight && rect.top - 4 - h > 0) {
      setFlip(true);
    }
  }, [open, rect]);

  const menuStyle = rect
    ? {
        left: rect.left,
        width: rect.width,
        ...(flip
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      }
    : undefined;

  return (
    <div ref={triggerRef} className="relative">
      <DashedAddButton
        onClick={openMenu}
        title="Add effect"
        label="Add effect"
      />
      {open && menuStyle && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[70] flex flex-wrap gap-1 p-2 shadow-md"
          style={{
            ...menuStyle,
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
          }}
        >
          {FX_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className="inline-flex items-center gap-1 text-[10px] leading-none px-2 py-1 rounded-full transition-colors"
              style={{
                border: '1px solid var(--color-border-strong)',
                color: 'var(--color-secondary-hover)',
                background: 'transparent',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--color-primary)';
                e.currentTarget.style.borderColor = 'var(--color-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--color-secondary-hover)';
                e.currentTarget.style.borderColor = 'var(--color-border-strong)';
              }}
              onClick={() => { onAdd(type); setOpen(false); }}
            >
              {isStableAudioFx(type) && <Sparkles size={10} />}
              {FX_TYPE_LABELS[type]}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
