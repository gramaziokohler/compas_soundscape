'use client';

import { useSyncExternalStore } from 'react';
import { globalUndo, globalRedo, subscribeUndoRedo, getUndoRedoSnapshot } from '@/store';

export function UndoRedoToolbar() {
  const { canUndo, canRedo } = useSyncExternalStore(
    subscribeUndoRedo,
    getUndoRedoSnapshot,
    getUndoRedoSnapshot,
  );

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={globalUndo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        className="flex items-center justify-center w-7 h-7 text-neutral-500 hover:text-neutral-900 disabled:text-neutral-300 disabled:cursor-not-allowed transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
        </svg>
      </button>

      <button
        onClick={globalRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
        aria-label="Redo"
        className="flex items-center justify-center w-7 h-7 text-neutral-500 hover:text-neutral-900 disabled:text-neutral-300 disabled:cursor-not-allowed transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 14 5-5-5-5" />
          <path d="M20 9H9a5 5 0 0 0 0 10h1" />
        </svg>
      </button>
    </div>
  );
}
