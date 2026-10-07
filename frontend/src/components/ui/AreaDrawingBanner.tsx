'use client';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAreaDrawingStore } from '@/store';
import { AREA_DRAWING } from '@/utils/constants';

interface AreaDrawingBannerProps {
  /** Close the polygon (same as Enter). */
  onConfirm: () => void;
  /** Leave drawing mode without an area. */
  onCancel: () => void;
}

/**
 * AreaDrawingBanner Component
 *
 * Validation bar shown while a polygon is being drawn in the viewer. Same
 * template as the "select objects" ObjectPickerBar (ConfirmDialog), in the
 * amber drawing color: Validate lights up once the polygon has enough points.
 */
export function AreaDrawingBanner({ onConfirm, onCancel }: AreaDrawingBannerProps) {
  const pointCount = useAreaDrawingStore((s) => s.drawingPointCount);

  return (
    <ConfirmDialog
      variant="warning"
      message="Click on the model to place points, then validate (or press Enter)."
      confirmLabel="Validate"
      cancelLabel="Cancel"
      disableConfirm={pointCount < AREA_DRAWING.MIN_VERTICES}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
