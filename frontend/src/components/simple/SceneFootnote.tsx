'use client';

import { useCallback } from 'react';
import { useAnalysisStore } from '@/store';
import { useCanEdit } from '@/hooks/useCanEdit';
import { useNameEditing } from '@/utils/useNameEditing';
import { SIMPLE_MODE } from '@/utils/constants';

export interface SceneFootnoteProps {
  usageIndex: number;
  footnote?: string;
}

/**
 * SceneFootnote
 *
 * Optional footnote at the bottom-left of a scene panel (the spot of a simulation
 * card's "Solved in …" line), saved as the usage card's `footnote`. Click to edit
 * (Enter / blur saves, Esc cancels, empty clears). Read-only in the share view,
 * where an empty footnote renders nothing.
 *
 * Usage:
 * ```tsx
 * <BubblePanel footerNote={<SceneFootnote usageIndex={i} footnote={config.footnote} />} … />
 * ```
 */
export function SceneFootnote({ usageIndex, footnote }: SceneFootnoteProps) {
  const canEdit = useCanEdit();
  const save = useCallback((text: string) => {
    useAnalysisStore.getState().handleUpdateConfig(usageIndex, { footnote: text || undefined });
  }, [usageIndex]);
  const { isEditing, startEdit, inputProps } = useNameEditing({
    initialValue: footnote ?? '',
    onSave: save,
    minLength: 0,
  });

  if (isEditing) {
    return (
      <input
        {...inputProps}
        maxLength={SIMPLE_MODE.SCENE_FOOTNOTE_MAX_CHARS}
        placeholder={SIMPLE_MODE.SCENE_FOOTNOTE_PLACEHOLDER}
        className="bubble-panel__title-input text-xxs text-foreground"
        aria-label="Scene footnote"
      />
    );
  }
  if (!canEdit) {
    return footnote ? <div className="truncate" title={footnote}>{footnote}</div> : null;
  }
  return (
    <button
      type="button"
      className={`block max-w-full truncate text-left hover:text-foreground ${footnote ? '' : 'italic opacity-70'}`}
      onClick={startEdit}
      title={footnote ? `${footnote}\n(click to edit)` : undefined}
    >
      {footnote || SIMPLE_MODE.SCENE_FOOTNOTE_PLACEHOLDER}
    </button>
  );
}
