'use client';

import { useState, useCallback, type KeyboardEvent, type ChangeEvent } from 'react';

/**
 * useNameEditing Hook
 *
 * Provides name editing functionality for components with editable titles.
 * Handles the editing state, value management, and keyboard events.
 *
 * **Features:**
 * - Start editing on double-click
 * - Save on Enter key or blur
 * - Cancel on Escape key
 * - Returns controlled input props
 *
 * **Usage:**
 * ```tsx
 * const {
 *   isEditing,
 *   editingValue,
 *   startEdit,
 *   saveEdit,
 *   cancelEdit,
 *   inputProps
 * } = useNameEditing({
 *   initialValue: config.display_name || 'Default Name',
 *   onSave: (newName) => onUpdateConfig(index, { display_name: newName })
 * });
 *
 * return isEditing ? (
 *   <input {...inputProps} />
 * ) : (
 *   <div onDoubleClick={startEdit}>{displayName}</div>
 * );
 * ```
 */

export interface UseNameEditingOptions {
  /** Initial value for the editable name */
  initialValue: string;
  /** Callback when name is saved */
  onSave: (newName: string) => void;
  /** Minimum length for valid name (default: 1) */
  minLength?: number;
}

export interface UseNameEditingResult {
  /** Whether currently in editing mode */
  isEditing: boolean;
  /** Current editing value */
  editingValue: string;
  /** Start editing mode */
  startEdit: () => void;
  /** Save and exit editing mode */
  saveEdit: () => void;
  /** Cancel and exit editing mode */
  cancelEdit: () => void;
  /** Props to spread on the input element */
  inputProps: {
    type: 'text';
    value: string;
    onChange: (e: ChangeEvent<HTMLInputElement>) => void;
    onBlur: () => void;
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
    autoFocus: boolean;
  };
}

export function useNameEditing({
  initialValue,
  onSave,
  minLength = 1,
}: UseNameEditingOptions): UseNameEditingResult {
  const [isEditing, setIsEditing] = useState(false);
  const [editingValue, setEditingValue] = useState('');

  const startEdit = useCallback(() => {
    setIsEditing(true);
    setEditingValue(initialValue);
  }, [initialValue]);

  const saveEdit = useCallback(() => {
    const trimmedValue = editingValue.trim();
    if (trimmedValue.length >= minLength) {
      onSave(trimmedValue);
    }
    setIsEditing(false);
  }, [editingValue, minLength, onSave]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setEditingValue(e.target.value);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  }, [saveEdit, cancelEdit]);

  return {
    isEditing,
    editingValue,
    startEdit,
    saveEdit,
    cancelEdit,
    inputProps: {
      type: 'text',
      value: editingValue,
      onChange: handleChange,
      onBlur: saveEdit,
      onKeyDown: handleKeyDown,
      autoFocus: true,
    },
  };
}
