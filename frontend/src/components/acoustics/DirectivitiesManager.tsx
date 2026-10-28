'use client';

/**
 * DirectivitiesManager
 *
 * "My directivities" dialog: the user's imported balloons with Rename / Delete,
 * the measured presets (read-only, with their preparation state) and the
 * directivities shared by the loaded soundscape. Deleting one that sounds use
 * asks first and resets those sounds to omnidirectional.
 *
 * Rendered by DirectivityDialogsHost from `directivityStore.dialog`.
 */

import { useMemo, useState } from 'react';
import { useDirectivityStore } from '@/store/directivityStore';
import { useSoundscapeStore } from '@/store/soundscapeStore';
import { ModalShell } from '@/components/ui/ModalShell';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { fitExplainedPercent } from '@/lib/acoustics/directivity-polar';
import { DIRECTIVITY, FORM_FIELD_CLASS, UI_BORDER_RADIUS } from '@/utils/constants';
import type { DirectivityRecord } from '@/types/directivity';

const ROW_BUTTON_CLASS =
  'px-1.5 py-0.5 text-[10px] font-medium rounded text-secondary-hover hover:text-foreground hover:bg-secondary-lighter transition-colors disabled:opacity-40';

function describe(record: DirectivityRecord): string {
  const parts: string[] = [];
  if (record.source_label) parts.push(record.source_label);
  if (record.n_points) parts.push(`${record.n_points} directions`);
  const explained = fitExplainedPercent(record.fit_residual);
  if (explained !== null) parts.push(`wave solver fit ${explained}%`);
  if (!record.available) parts.push(DIRECTIVITY.PREPARING_TAG);
  return parts.join(' · ');
}

function DirectivityRow({ record, actions }: { record: DirectivityRecord; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-foreground">{record.name}</span>
        <span className="block truncate text-[10px] text-secondary-hover">{describe(record)}</span>
      </span>
      {actions && <span className="shrink-0 flex gap-0.5">{actions}</span>}
    </div>
  );
}

export function DirectivitiesManager() {
  const presets = useDirectivityStore((s) => s.presets);
  const library = useDirectivityStore((s) => s.library);
  const snapshot = useDirectivityStore((s) => s.snapshot);
  const status = useDirectivityStore((s) => s.status);
  const closeDialog = useDirectivityStore((s) => s.closeDialog);
  const openImport = useDirectivityStore((s) => s.openImport);
  const rename = useDirectivityStore((s) => s.rename);
  const remove = useDirectivityStore((s) => s.remove);
  const soundscapeData = useSoundscapeStore((s) => s.soundscapeData);
  const updateSoundDirectivity = useSoundscapeStore((s) => s.updateSoundDirectivity);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const libraryIds = useMemo(() => new Set(library.map((r) => r.id)), [library]);
  const shared = useMemo(() => snapshot.filter((r) => !libraryIds.has(r.id)), [snapshot, libraryIds]);
  const measuredPresets = useMemo(() => presets.filter((r) => r.kind === 'measured'), [presets]);

  const soundsUsing = (id: string) => (soundscapeData ?? []).filter((s) => s.directivity?.id === id);

  const handleDelete = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await remove(id);
      // One call per prompt is enough: the store fans the change out to the variants.
      const seenPrompts = new Set<number | undefined>();
      for (const sound of soundsUsing(id)) {
        if (seenPrompts.has(sound.prompt_index)) continue;
        seenPrompts.add(sound.prompt_index);
        updateSoundDirectivity(sound.id, undefined);
      }
      setConfirmDeleteId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete directivity');
    } finally {
      setBusyId(null);
    }
  };

  const handleRename = async (id: string) => {
    const next = draftName.trim();
    if (!next) return;
    setBusyId(id);
    setError(null);
    try {
      await rename(id, next);
      setRenamingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename directivity');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ModalShell title={DIRECTIVITY.MANAGE_LABEL} onClose={closeDialog} width={DIRECTIVITY.MANAGER_WIDTH}>
      <div className="flex flex-col gap-3">
        <p className="text-[11px] text-secondary-hover">
          Imported balloons are private to your account and available in every workspace. Soundscapes you share keep
          a copy of the balloons their sounds use.
        </p>

        <div className="flex flex-col divide-y divide-secondary-light">
          {library.length === 0 && (
            <p className="text-xs text-secondary-hover py-2">
              {status === 'loading' ? 'Loading…' : 'No imported directivities yet.'}
            </p>
          )}
          {library.map((r) => {
            const used = soundsUsing(r.id).length;
            return (
              <div key={r.id}>
                {renamingId === r.id ? (
                  <form
                    className="flex items-center gap-1 py-1"
                    onSubmit={(e) => { e.preventDefault(); void handleRename(r.id); }}
                  >
                    <input
                      className={FORM_FIELD_CLASS}
                      value={draftName}
                      maxLength={DIRECTIVITY.NAME_MAX_LEN}
                      onChange={(e) => setDraftName(e.target.value)}
                      autoFocus
                    />
                    <button type="submit" className={ROW_BUTTON_CLASS} disabled={busyId === r.id}>Save</button>
                    <button type="button" className={ROW_BUTTON_CLASS} onClick={() => setRenamingId(null)}>Cancel</button>
                  </form>
                ) : (
                  <DirectivityRow
                    record={r}
                    actions={(
                      <>
                        <button type="button" className={ROW_BUTTON_CLASS} onClick={() => { setRenamingId(r.id); setDraftName(r.name); }}>
                          Rename
                        </button>
                        <button
                          type="button"
                          className={ROW_BUTTON_CLASS}
                          style={{ color: 'var(--color-error)' }}
                          disabled={busyId === r.id}
                          onClick={() => setConfirmDeleteId(r.id)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  />
                )}
                {confirmDeleteId === r.id && (
                  <div className="pb-2">
                    <ConfirmDialog
                      variant="danger"
                      message={used > 0
                        ? `Delete “${r.name}”? ${used} sound${used === 1 ? '' : 's'} use${used === 1 ? 's' : ''} it — they become omnidirectional.`
                        : `Delete “${r.name}”? This cannot be undone.`}
                      confirmLabel="Delete"
                      disabled={busyId === r.id}
                      onCancel={() => setConfirmDeleteId(null)}
                      onConfirm={() => handleDelete(r.id)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {measuredPresets.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xxs card-label text-secondary-hover">Built-in measured presets</span>
            <div className="flex flex-col divide-y divide-secondary-light">
              {measuredPresets.map((r) => <DirectivityRow key={r.id} record={r} />)}
            </div>
          </div>
        )}

        {shared.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xxs card-label text-secondary-hover">Shared in this soundscape</span>
            <div className="flex flex-col divide-y divide-secondary-light">
              {shared.map((r) => <DirectivityRow key={r.id} record={r} />)}
            </div>
          </div>
        )}

        {error && <p className="text-[10px] font-medium" style={{ color: 'var(--color-error)' }}>{error}</p>}

        <button
          type="button"
          onClick={() => openImport({ returnToManager: true })}
          className="w-full py-1.5 text-xs font-medium rounded transition-colors"
          style={{ background: 'var(--color-primary)', color: 'var(--color-on-blue)', borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
        >
          {DIRECTIVITY.IMPORT_LABEL}
        </button>
      </div>
    </ModalShell>
  );
}
