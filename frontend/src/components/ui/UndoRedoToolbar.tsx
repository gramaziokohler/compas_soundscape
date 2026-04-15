'use client';

import { useSyncExternalStore } from 'react';
import { globalUndo, globalRedo, subscribeUndoRedo, getUndoRedoSnapshot } from '@/store';

/**
 * Undo/Redo toolbar buttons.
 * Reactively updates when history changes via useSyncExternalStore.
 */
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
        className="flex items-center justify-center w-7 h-7 rounded text-xs text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7v6h6" />
          <path d="M3 13C5.33 8.67 9.33 6 14 6c4.42 0 8.17 2.67 10 7" />
        </svg>
      </button>
      <button
        onClick={globalRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
        aria-label="Redo"
        className="flex items-center justify-center w-7 h-7 rounded text-xs text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 7v6h-6" />
          <path d="M21 13c-2.33-4.33-6.33-7-11-7-4.42 0-8.17 2.67-10 7" />
        </svg>
      </button>
    </div>
  );
}
