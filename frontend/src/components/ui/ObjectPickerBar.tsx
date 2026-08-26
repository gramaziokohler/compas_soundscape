"use client";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { HelperHint } from "@/components/ui/HelperHint";

export interface ObjectPickerBarProps {
  /** Whether the selection UI is active (grid: selecting, sound: linking). */
  isSelecting: boolean;
  /** Number of currently selected objects. Confirm lights up when > 0. */
  selectedCount: number;
  /** Message shown in the ConfirmDialog. */
  message?: string;
  /** Label for the confirm button. */
  confirmLabel?: string;
  /** Label for the cancel button. */
  cancelLabel?: string;
  /** Hint text shown below the buttons. */
  hintText?: string;
  /** Called when confirm is pressed. */
  onConfirm: () => void;
  /** Called when cancel is pressed. */
  onCancel: () => void;
  /** When true, recolors the ConfirmDialog for legibility on a solid-blue generated card. */
  onBlueBackground?: boolean;
}

/**
 * Shared object-picker confirmation bar — used by both grid-listeners and
 * sound-card entity linking for the "select objects in the 3D viewer" phase.
 *
 * Template matches the grid-listener UX exactly:
 * - Cancel is always enabled so the user can back out.
 * - The confirm button lights up (primary background) only when there is at
 *   least one selected object (`selectedCount > 0`); otherwise it is dimmed.
 * - A HelperHint reminds the user about shift-click multi-select and Enter.
 *
 * Usage:
 * ```tsx
 * <ObjectPickerBar
 *   isSelecting={isSelecting}
 *   selectedCount={selectedObjectIds.length}
 *   message="Select objects in the 3D view to link them."
 *   confirmLabel="Done"
 *   cancelLabel="Cancel"
 *   hintText="Hold shift to select multiple objects, press Enter when finished."
 *   onConfirm={commit}
 *   onCancel={cancel}
 * />
 * ```
 */
export function ObjectPickerBar({
  isSelecting,
  selectedCount,
  message = "Select one or multiple objects in the 3D view to link them.",
  confirmLabel = "Done",
  cancelLabel = "Cancel",
  hintText = "Hold shift to select multiple objects, press Enter when finished.",
  onConfirm,
  onCancel,
  onBlueBackground = false,
}: ObjectPickerBarProps) {
  if (!isSelecting) return null;

  return (
    <>
      <ConfirmDialog
        message={message}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        disableConfirm={selectedCount === 0}
        onConfirm={onConfirm}
        onCancel={onCancel}
        onBlueBackground={onBlueBackground}
      />
      <HelperHint text={hintText} />
    </>
  );
}
