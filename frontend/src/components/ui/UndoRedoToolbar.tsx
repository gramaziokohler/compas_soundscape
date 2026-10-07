'use client';

import { useSyncExternalStore } from 'react';
import { globalUndo, globalRedo, subscribeUndoRedo, getUndoRedoSnapshot } from '@/store';
import { BarButton } from '@/components/ui/BarButton';
import { SCENE_BOTTOM_BAR } from '@/utils/constants';

function HistoryIcon({ redo = false }: { redo?: boolean }) {
  return (
    <svg
      width={SCENE_BOTTOM_BAR.ICON_SIZE}
      height={SCENE_BOTTOM_BAR.ICON_SIZE}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={redo ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
    </svg>
  );
}

/**
 * Global undo / redo pair for the scene bottom bar (disabled when the
 * corresponding history stack is empty).
 *
 * Usage:
 * ```tsx
 * <UndoRedoToolbar />
 * ```
 */
export function UndoRedoToolbar() {
  const { canUndo, canRedo } = useSyncExternalStore(
    subscribeUndoRedo,
    getUndoRedoSnapshot,
    getUndoRedoSnapshot,
  );

  return (
    <div className="scene-bottom-bar__group">
      <BarButton onClick={globalUndo} disabled={!canUndo} title="Undo" shortcut="UNDO" icon={<HistoryIcon />} />
      <BarButton onClick={globalRedo} disabled={!canRedo} title="Redo" shortcut="REDO" icon={<HistoryIcon redo />} />
    </div>
  );
}
