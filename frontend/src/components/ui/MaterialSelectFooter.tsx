'use client';

/**
 * MaterialSelectFooter
 *
 * Sticky footer of the MaterialSelect menu: "+ New material…" opens the custom
 * material editor (the saved material is handed to `onCreated`, so the picker's
 * surfaces get it assigned right away) and "My materials" opens the library
 * manager. Both dialogs are rendered once by CustomMaterialDialogsHost.
 *
 * Usage:
 * ```tsx
 * <CardSelect menuFooter={(close) => <MaterialSelectFooter close={close} onCreated={onChange} />} />
 * ```
 */

import { useCustomMaterialStore } from '@/store';
import { CUSTOM_MATERIAL } from '@/utils/constants';

interface MaterialSelectFooterProps {
  /** Closes the dropdown menu. */
  close: () => void;
  /** Receives the id of a material created from this footer. */
  onCreated?: (materialId: string) => void;
}

export function MaterialSelectFooter({ close, onCreated }: MaterialSelectFooterProps) {
  const openEditor = useCustomMaterialStore((s) => s.openEditor);
  const openManager = useCustomMaterialStore((s) => s.openManager);
  const libraryCount = useCustomMaterialStore((s) => s.library.length);

  return (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        className="select-opt compact flex-1 text-left font-semibold"
        style={{ color: 'var(--color-primary)' }}
        onClick={() => {
          close();
          openEditor({ onSaved: onCreated });
        }}
      >
        {CUSTOM_MATERIAL.NEW_LABEL}
      </button>
      {libraryCount > 0 && (
        <button
          type="button"
          className="select-opt compact shrink-0 text-right text-secondary-hover"
          onClick={() => {
            close();
            openManager();
          }}
        >
          {CUSTOM_MATERIAL.MANAGE_LABEL} ({libraryCount})
        </button>
      )}
    </div>
  );
}
