'use client';

/**
 * DirectivityDialogsHost
 *
 * Mounted once (page root). Renders the directivity import dialog or the
 * library manager named by `directivityStore.dialog`, so the picker inside a
 * sound card can open them without owning (and unmounting) the dialog.
 */

import { useDirectivityStore } from '@/store/directivityStore';
import { DirectivityImportDialog } from './DirectivityImportDialog';
import { DirectivitiesManager } from './DirectivitiesManager';

export function DirectivityDialogsHost() {
  const dialog = useDirectivityStore((s) => s.dialog);
  if (!dialog) return null;
  if (dialog.kind === 'manager') return <DirectivitiesManager />;
  return <DirectivityImportDialog onImported={dialog.onImported} />;
}
