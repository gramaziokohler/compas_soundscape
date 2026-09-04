import type { CSSProperties } from 'react';
import { estimateFieldWidthCh } from '@/components/ui/numberFieldSizing';
import {
  PYROOMACOUSTICS_SCATTERING_MIN,
  PYROOMACOUSTICS_SCATTERING_MAX,
} from '@/utils/constants';

/** Editable scattering field width — shared by header label column and row inputs. */
export const OBJECT_EXPLORER_SCATTERING_FIELD_CH = estimateFieldWidthCh(
  PYROOMACOUSTICS_SCATTERING_MIN,
  PYROOMACOUSTICS_SCATTERING_MAX,
  2,
);

/** Reload (18px) + gap (8px) + close (18px) in the panel header. */
export const OBJECT_EXPLORER_PANEL_ACTIONS_WIDTH_PX = 44;

export const OBJECT_EXPLORER_ACOUSTIC_COLUMN_GAP_PX = 4;

/** Horizontal padding shared by the panel header and tree rows (12px = Tailwind px-3). */
export const OBJECT_EXPLORER_ROW_PADDING_PX = 12;

/**
 * Grid columns for Object Explorer rows / header when acoustic material columns are shown.
 * Col 1: tree title · Col 2: material (max-content, right-aligned) · Col 3: scattering · Col 4: actions
 */
export function objectExplorerAcousticGridColumns(showScattering: boolean): string {
  if (showScattering) {
    return `minmax(0, 1fr) max-content ${OBJECT_EXPLORER_SCATTERING_FIELD_CH}ch ${OBJECT_EXPLORER_PANEL_ACTIONS_WIDTH_PX}px`;
  }
  return `minmax(0, 1fr) max-content ${OBJECT_EXPLORER_PANEL_ACTIONS_WIDTH_PX}px`;
}

export function objectExplorerAcousticGridStyle(showScattering: boolean): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: objectExplorerAcousticGridColumns(showScattering),
    columnGap: `${OBJECT_EXPLORER_ACOUSTIC_COLUMN_GAP_PX}px`,
    alignItems: 'center',
    width: '100%',
    minWidth: 0,
  };
}
