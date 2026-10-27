'use client';

/**
 * CustomMaterialDialogsHost
 *
 * Mounted once (page root). Renders the custom-material editor or manager
 * named by `customMaterialStore.dialog`, so pickers inside virtualized rows
 * can open them without owning (and unmounting) the dialog.
 */

import { useCustomMaterialStore } from '@/store';
import { CustomMaterialDialog } from './CustomMaterialDialog';
import { CustomMaterialsManager } from './CustomMaterialsManager';

export function CustomMaterialDialogsHost() {
  const dialog = useCustomMaterialStore((s) => s.dialog);
  if (!dialog) return null;
  if (dialog.kind === 'manager') return <CustomMaterialsManager />;
  return (
    <CustomMaterialDialog
      // Remount per target so the form re-initialises when switching materials.
      key={`${dialog.materialId ?? ''}|${dialog.templateId ?? ''}`}
      materialId={dialog.materialId}
      templateId={dialog.templateId}
      onSaved={dialog.onSaved}
    />
  );
}
