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
        className="flex items-center justify-center w-7 h-7 text-zinc-500 hover:text-zinc-900 disabled:text-zinc-300 disabled:cursor-not-allowed transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 12H5" />
          <path d="M11 6l-6 6 6 6" />
        </svg>
      </button>

      <button
        onClick={globalRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
        aria-label="Redo"
        className="flex items-center justify-center w-7 h-7 text-zinc-500 hover:text-zinc-900 disabled:text-zinc-300 disabled:cursor-not-allowed transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12h15" />
          <path d="M13 6l6 6-6 6" />
        </svg>
      </button>
    </div>
  );
}
