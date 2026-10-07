'use client';

import { useEffect, useRef } from 'react';
import { BarButton } from '@/components/ui/BarButton';
import { ShortcutKeys } from '@/components/ui/ShortcutKeys';
import { useUIStore } from '@/store';
import {
  FPS_CONTROLS,
  KEYBOARD_SHORTCUTS,
  SCENE_BOTTOM_BAR,
  SHORTCUT_GROUP_ORDER,
  type ShortcutDef,
} from '@/utils/constants';

interface ShortcutRow {
  label: string;
  keys: string;
  altKeys?: string;
  hint?: string;
}

// Mouse gestures — documented here only (not keyboard-handled).
const VIEWER_SHORTCUTS: ShortcutRow[] = [
  { label: 'Select', keys: 'Left-click' },
  { label: 'Pan', keys: 'Middle-click' },
  { label: 'Rotate', keys: 'Right-click' },
  { label: 'Add to selection', keys: 'Shift + click' },
  { label: 'Deselect', keys: 'Ctrl + click' },
  { label: 'Box select', keys: 'Left-drag', hint: 'Left→right: fully inside · right→left: touching' },
  { label: 'Box select sounds & listeners only', keys: 'Ctrl + drag' },
];

const FPS_SHORTCUTS: ShortcutRow[] = FPS_CONTROLS.map(({ label, keys }) => ({ label, keys }));

const CARD_MOUSE_SHORTCUTS: ShortcutRow[] = [
  { label: 'Duplicate a card', keys: 'Ctrl + drag' },
  { label: 'Card options', keys: 'Right-click' },
  { label: 'Zoom into sound sphere', keys: 'Double-click' },
];

// DAW timeline — dock-scoped keys and ruler/clip gestures (handled in DAWDock / DAWRuler).
const TIMELINE_SHORTCUTS: ShortcutRow[] = [
  { label: 'Select all clips', keys: 'Ctrl + A' },
  { label: 'Copy selected', keys: 'Ctrl + C' },
  { label: 'Paste at playhead', keys: 'Ctrl + V' },
  { label: 'Delete selected', keys: 'Delete' },
  { label: 'Nudge by snap step', keys: '← / →' },
  { label: 'Nudge ×10', keys: 'Shift + ← / →' },
  { label: 'Add to selection', keys: 'Shift + click', altKeys: 'Ctrl + click' },
  { label: 'Clear selection', keys: 'Esc' },
  { label: 'Seek', keys: 'Click ruler' },
  { label: 'Set loop region', keys: 'Drag ruler' },
  { label: 'Remove loop region', keys: 'Double-click loop' },
  { label: 'Horizontal zoom', keys: 'Alt + wheel' },
  { label: 'Track height zoom', keys: 'Ctrl + wheel' },
];

/** Keyboard shortcuts grouped in display order, from the KEYBOARD_SHORTCUTS constant. */
const KEYBOARD_SECTIONS = SHORTCUT_GROUP_ORDER.map((group) => ({
  title: group,
  rows: (Object.values(KEYBOARD_SHORTCUTS) as ShortcutDef[])
    .filter((def) => def.group === group)
    .map<ShortcutRow>(({ label, keys, altKeys, hint }) => ({ label, keys, altKeys, hint })),
}));

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
  const open = useUIStore((s) => s.shortcutsOpen);
  const setOpen = useUIStore((s) => s.setShortcutsOpen);
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
  }, [open, setOpen]);

  const sections: { title: string; rows: ShortcutRow[] }[] = [
    ...KEYBOARD_SECTIONS.map((section) =>
      section.title === 'Cards'
        ? { ...section, rows: [...section.rows, ...CARD_MOUSE_SHORTCUTS] }
        : section,
    ),
    { title: 'Timeline', rows: TIMELINE_SHORTCUTS },
    { title: isFirstPersonMode ? 'First-person view' : '3D view', rows: isFirstPersonMode ? FPS_SHORTCUTS : VIEWER_SHORTCUTS },
  ];

  return (
    <div ref={rootRef} className="relative flex items-center">
      <BarButton
        onClick={() => setOpen(!open)}
        active={open}
        dot={isFirstPersonMode && !open}
        title={isFirstPersonMode ? 'Shortcuts — first-person controls' : 'Shortcuts'}
        shortcut="SHOW_SHORTCUTS"
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
            maxHeight: SCENE_BOTTOM_BAR.POPOVER_MAX_HEIGHT,
            overflowY: 'auto',
            padding: '6px 12px 10px',
          }}
        >
          {sections.map((section) => (
            <div key={section.title}>
              <div className="bar-popover__title">{section.title}</div>
              {section.rows.map((row) => (
                <div key={row.label} className="bar-shortcut-row">
                  <span className="bar-shortcut-row__label">
                    <span>{row.label}</span>
                    {row.hint && <span className="bar-shortcut-row__hint">{row.hint}</span>}
                  </span>
                  <ShortcutKeys keys={row.keys} altKeys={row.altKeys} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
