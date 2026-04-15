import { useCallback } from 'react';
import { pauseStore, commitStore } from '@/store';

/**
 * useBatchedSlider
 *
 * Wraps a slider (or any continuous pointer gesture) so that only the
 * start-value and end-value are saved as a single undo step — not every
 * intermediate pixel movement.
 *
 * Mechanism:
 *  - onDragStart  → `pauseStore(storeId)` snapshots pre-drag state and pauses
 *                   temporal recording so intermediate `onChange` calls are NOT
 *                   added to undo history.
 *  - onCommit     → `commitStore(storeId)` pushes the snapshot to pastStates
 *                   and resumes recording.
 *
 * Works for any registered store (audioControls, acousticMaterial, …).
 * Also usable for ThreeJS drag objects — call `onDragStart` on pointerdown
 * and `onCommit` on pointerup.
 *
 * @param storeId  The ID used when calling registerTemporalStore in store/index.ts
 * @param onChange  The live-update function (called on every step for visual feedback)
 * @param onCommit  The commit function (called on release with the final value).
 *                  Defaults to `onChange` — pass the same function when the store
 *                  action already updates the store and you just need batching.
 *
 * @returns { onDragStart, onChange: wrappedOnChange, onCommit: wrappedOnCommit }
 *
 * Usage in a component:
 * ```tsx
 * const { onDragStart, onChange, onCommit } = useBatchedSlider(
 *   'audioControls',
 *   (v) => setTempVolume(v),          // visual only (no store write)
 *   (v) => store.handleVolumeChange(id, v),  // store write on commit
 * );
 * <VerticalVolumeSlider
 *   onDragStart={onDragStart}
 *   onChange={onChange}
 *   onChangeCommitted={onCommit}
 * />
 * ```
 */
export function useBatchedSlider<T>(
  storeId: string,
  onChange: (value: T) => void,
  onCommit?: (value: T) => void,
): {
  onDragStart: () => void;
  onChange: (value: T) => void;
  onCommit: (value: T) => void;
} {
  const handleDragStart = useCallback(() => {
    pauseStore(storeId);
  }, [storeId]);

  const handleChange = useCallback(
    (value: T) => {
      onChange(value);
    },
    [onChange],
  );

  const handleCommit = useCallback(
    (value: T) => {
      // Apply the final value first so the store reflects the committed state.
      (onCommit ?? onChange)(value);
      // Then push the pre-drag snapshot to history.
      commitStore(storeId);
    },
    [storeId, onChange, onCommit],
  );

  return { onDragStart: handleDragStart, onChange: handleChange, onCommit: handleCommit };
}
