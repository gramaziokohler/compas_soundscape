/**
 * openMaterialsExplorer
 *
 * Shared "jump to the materials in the Object Explorer" action. Used by the
 * material count dot in SimulationSummaryBar and by AcousticMaterialsSummary so
 * both behave identically: switch the viewer to acoustic view mode and reveal
 * the Object Explorer panel.
 */

import { useSpeckleStore, useUIStore } from '@/store';

/** DOM id of the Object Explorer panel — target of the SectionHighlight ring. */
export const OBJECT_EXPLORER_PANEL_ID = 'object-explorer-panel';

export function openMaterialsExplorer(): void {
  const { viewMode, setViewMode } = useSpeckleStore.getState();
  if (viewMode !== 'acoustic') {
    setViewMode('acoustic');
  }
  useUIStore.getState().setShowObjectExplorer(true);
}
