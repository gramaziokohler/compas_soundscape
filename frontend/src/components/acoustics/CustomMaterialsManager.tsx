'use client';

/**
 * CustomMaterialsManager
 *
 * "My materials" dialog: lists the user's custom materials (colour, mini
 * histogram, mean absorption) with Edit / Duplicate / Delete, and below them
 * the materials of a shared soundscape that are not in the library, with
 * "Save to my materials". Deleting a material that is assigned in the current
 * model asks first and unassigns those surfaces.
 *
 * Rendered by CustomMaterialDialogsHost from `customMaterialStore.dialog`.
 */

import { useMemo, useState } from 'react';
import { useAcousticMaterialStore, useCustomMaterialStore } from '@/store';
import { ModalShell } from '@/components/ui/ModalShell';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { buildMiniHistogramSVG } from '@/lib/audio/utils/absorption-histogram-utils';
import { getMaterialColorByAbsorption } from '@/utils/utils';
import { CUSTOM_MATERIAL, UI_BORDER_RADIUS } from '@/utils/constants';
import type { CustomMaterialRecord } from '@/types/materials';

const ROW_BUTTON_CLASS =
  'px-1.5 py-0.5 text-[10px] font-medium rounded text-secondary-hover hover:text-foreground hover:bg-secondary-lighter transition-colors disabled:opacity-40';

function MaterialRow({ material, actions }: { material: CustomMaterialRecord; actions: React.ReactNode }) {
  const icon = useMemo(() => buildMiniHistogramSVG(material.coeffs, CUSTOM_MATERIAL.LIST_ICON_SIZE), [material.coeffs]);
  return (
    <div className="flex items-center gap-2 py-1">
      <span
        className="shrink-0"
        style={{ width: CUSTOM_MATERIAL.LIST_ICON_SIZE, height: CUSTOM_MATERIAL.LIST_ICON_SIZE, borderRadius: 2, overflow: 'hidden' }}
        aria-hidden
        dangerouslySetInnerHTML={{ __html: icon }}
      />
      <span
        className="inline-block w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: getMaterialColorByAbsorption(material.absorption) }}
        aria-hidden
      />
      <span className="min-w-0 flex-1" title={material.description || material.name}>
        <span className="block truncate text-xs text-foreground">{material.name}</span>
        {material.description && (
          <span className="block truncate text-[10px] text-secondary-hover">{material.description}</span>
        )}
      </span>
      <span className="shrink-0 text-[10px] text-secondary-hover tabular-nums">
        {(material.absorption * 100).toFixed(0)}%
      </span>
      <span className="shrink-0 flex gap-0.5">{actions}</span>
    </div>
  );
}

export function CustomMaterialsManager() {
  const library = useCustomMaterialStore((s) => s.library);
  const snapshot = useCustomMaterialStore((s) => s.snapshot);
  const status = useCustomMaterialStore((s) => s.status);
  const openEditor = useCustomMaterialStore((s) => s.openEditor);
  const closeDialog = useCustomMaterialStore((s) => s.closeDialog);
  const create = useCustomMaterialStore((s) => s.create);
  const remove = useCustomMaterialStore((s) => s.remove);
  const materialAssignments = useAcousticMaterialStore((s) => s.materialAssignments);
  const assignMaterialToObjects = useAcousticMaterialStore((s) => s.assignMaterialToObjects);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const libraryIds = useMemo(() => new Set(library.map((m) => m.id)), [library]);
  const shared = useMemo(() => snapshot.filter((m) => !libraryIds.has(m.id)), [snapshot, libraryIds]);

  const assignedObjectIds = (materialId: string) =>
    [...materialAssignments.entries()].filter(([, id]) => id === materialId).map(([objectId]) => objectId);

  const handleDelete = async (materialId: string) => {
    setBusyId(materialId);
    setError(null);
    try {
      await remove(materialId);
      const objectIds = assignedObjectIds(materialId);
      if (objectIds.length > 0) assignMaterialToObjects(objectIds, '');
      setConfirmDeleteId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete material');
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveShared = async (material: CustomMaterialRecord) => {
    setBusyId(material.id);
    setError(null);
    try {
      await create({ name: material.name, description: material.description, coeffs: material.coeffs });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save material');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ModalShell title={CUSTOM_MATERIAL.MANAGE_LABEL} onClose={closeDialog} width={CUSTOM_MATERIAL.MANAGER_WIDTH}>
      <div className="flex flex-col gap-3">
        <p className="text-[11px] text-secondary-hover">
          Your materials are private to your account and available in every workspace. Soundscapes you share keep a
          read-only copy of the materials they use.
        </p>

        <div className="flex flex-col divide-y divide-secondary-light">
          {library.length === 0 && (
            <p className="text-xs text-secondary-hover py-2">
              {status === 'loading' ? 'Loading…' : 'No custom materials yet.'}
            </p>
          )}
          {library.map((m) => {
            const usedOn = assignedObjectIds(m.id).length;
            return (
              <div key={m.id}>
                <MaterialRow
                  material={m}
                  actions={(
                    <>
                      <button type="button" className={ROW_BUTTON_CLASS} onClick={() => openEditor({ materialId: m.id, returnToManager: true })}>
                        Edit
                      </button>
                      <button type="button" className={ROW_BUTTON_CLASS} onClick={() => openEditor({ templateId: m.id, returnToManager: true })}>
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className={ROW_BUTTON_CLASS}
                        style={{ color: 'var(--color-error)' }}
                        disabled={busyId === m.id}
                        onClick={() => setConfirmDeleteId(m.id)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                />
                {confirmDeleteId === m.id && (
                  <div className="pb-2">
                    <ConfirmDialog
                      variant="danger"
                      message={usedOn > 0
                        ? `Delete “${m.name}”? It is used on ${usedOn} surface${usedOn === 1 ? '' : 's'} in this model — they will be unassigned.`
                        : `Delete “${m.name}”? This cannot be undone.`}
                      confirmLabel="Delete"
                      disabled={busyId === m.id}
                      onCancel={() => setConfirmDeleteId(null)}
                      onConfirm={() => handleDelete(m.id)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {shared.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xxs card-label text-secondary-hover">Shared in this soundscape</span>
            <div className="flex flex-col divide-y divide-secondary-light">
              {shared.map((m) => (
                <MaterialRow
                  key={m.id}
                  material={m}
                  actions={(
                    <button
                      type="button"
                      className={ROW_BUTTON_CLASS}
                      disabled={busyId === m.id}
                      onClick={() => handleSaveShared(m)}
                    >
                      Save to my materials
                    </button>
                  )}
                />
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-[10px] font-medium" style={{ color: 'var(--color-error)' }}>{error}</p>}

        <button
          type="button"
          onClick={() => openEditor({ returnToManager: true })}
          className="w-full py-1.5 text-xs font-medium rounded transition-colors"
          style={{ background: 'var(--color-primary)', color: 'var(--color-on-blue)', borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
        >
          {CUSTOM_MATERIAL.NEW_LABEL}
        </button>
      </div>
    </ModalShell>
  );
}
