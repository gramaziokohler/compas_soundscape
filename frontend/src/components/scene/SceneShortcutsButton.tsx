'use client';

import { useEffect, useRef, useState } from 'react';
import { BarButton } from '@/components/ui/BarButton';
import { useIsMac } from '@/hooks/useIsMac';
import { formatShortcutKeys } from '@/utils/platform';
import { SCENE_BOTTOM_BAR } from '@/utils/constants';

interface ShortcutRow {
  label: string;
  command: string;
}

const VIEWER_SHORTCUTS: ShortcutRow[] = [
  { label: 'Select', command: 'Left-click' },
  { label: 'Pan', command: 'Middle-click' },
  { label: 'Rotate', command: 'Right-click' },
  { label: 'Add to selection', command: 'Shift + click' },
  { label: 'Deselect', command: 'Ctrl + click' },
];

const FPS_SHORTCUTS: ShortcutRow[] = [
  { label: 'Look around', command: 'Left-drag' },
  { label: 'Focal length', command: 'Scroll' },
  { label: 'Roll', command: 'Right-drag' },
  { label: 'Rotate view', command: 'Arrow keys' },
  { label: 'Exit first-person', command: 'Esc' },
];

const CARD_SHORTCUTS: ShortcutRow[] = [
  { label: 'Duplicate a card', command: 'Ctrl + drag' },
  { label: 'Card options', command: 'Right-click' },
  { label: 'Zoom into sound sphere', command: 'Double-click' },
];

const EDIT_SHORTCUTS: ShortcutRow[] = [
  { label: 'Undo', command: 'Ctrl + Z' },
  { label: 'Redo', command: 'Ctrl + Y' },
];

interface SceneShortcutsButtonProps {
  isFirstPersonMode: boolean;
}

/**
 * Keyboard / mouse shortcuts for the scene bottom bar. Opens a popover above
 * the bar and closes on outside click or Escape. In first-person mode the
 * button carries a dot (its controls differ from orbit mode) — it never opens
 * by itself, so entering a listener's view isn't interrupted.
 */
export function SceneShortcutsButton({ isFirstPersonMode }: SceneShortcutsButtonProps) {
  const isMac = useIsMac();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const sections: { title: string; rows: ShortcutRow[] }[] = [
    { title: isFirstPersonMode ? 'First-person view' : '3D view', rows: isFirstPersonMode ? FPS_SHORTCUTS : VIEWER_SHORTCUTS },
    { title: 'Cards', rows: CARD_SHORTCUTS },
    { title: 'Edit', rows: EDIT_SHORTCUTS },
  ];

  return (
    <div ref={rootRef} className="relative flex items-center">
      <BarButton
        onClick={() => setOpen((v) => !v)}
        active={open}
        dot={isFirstPersonMode && !open}
        title={isFirstPersonMode ? 'Shortcuts — first-person controls' : 'Shortcuts'}
        icon={
          <svg width={SCENE_BOTTOM_BAR.ICON_SIZE} height={SCENE_BOTTOM_BAR.ICON_SIZE} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
          </svg>
        }
      />
      {open && (
        <div
          className="bar-popover"
          role="dialog"
          aria-label="Shortcuts"
          style={{
            right: 0,
            position: 'absolute',
            bottom: `calc(100% + ${SCENE_BOTTOM_BAR.POPOVER_OFFSET}px)`,
            width: SCENE_BOTTOM_BAR.POPOVER_WIDTH,
            padding: '6px 12px 10px',
          }}
        >
          {sections.map((section) => (
            <div key={section.title}>
              <div className="bar-popover__title">{section.title}</div>
              {section.rows.map((row) => (
                <div key={row.label} className="bar-shortcut-row">
                  <span>{row.label}</span>
                  <kbd>{formatShortcutKeys(row.command, isMac)}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
