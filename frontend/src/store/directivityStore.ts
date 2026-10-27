/**
 * Directivity Store
 *
 * Source directivities a sound can be assigned: the built-in presets (analytical
 * Cardioid family + measured loudspeaker / HATS balloons), the current user's
 * imported library (backend `/api/me/directivities`, keyed by user identity) and
 * the read-only snapshot embedded in the loaded soundscape (so a shared
 * workspace's directivities resolve for collaborators).
 *
 * Not undoable and not persisted: the backend is the source of truth for the
 * library, `soundscape.json` (`directivities`) for the snapshot.
 *
 * Producer : DirectivitySelect (load), DirectivityImportDialog (importFile),
 *            DirectivitiesManager (rename / remove), soundscape load (setSnapshot)
 * Consumers: DirectivitySelect (option list), simulationRequest (id check),
 *            soundscape save (snapshot + ids to copy), sound-direction indicator
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { apiService } from '@/services/api';
import { DIRECTIVITY } from '@/utils/constants';
import type { DirectivityRecord, SoundDirectivity } from '@/types/directivity';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Which directivity dialog is open (one host renders it — see DirectivityDialogsHost). */
export type DirectivityDialog =
  | {
      kind: 'import';
      /** Called with the imported record (e.g. assign it to the sound that opened the dialog). */
      onImported?: (record: DirectivityRecord) => void;
      /** Reopen the manager when the import closes (opened from the manager). */
      returnToManager?: boolean;
    }
  | { kind: 'manager' };

export interface DirectivityStoreState {
  /** Built-in presets (analytical + measured) as listed by the backend. */
  presets: DirectivityRecord[];
  /** My imported directivities, sorted by name. */
  library: DirectivityRecord[];
  /** Directivities of the loaded soundscape (may belong to another user). */
  snapshot: DirectivityRecord[];
  status: LoadStatus;
  error: string | null;

  /** Fetch presets + library once (pass `force` to refetch, e.g. while presets are preparing). */
  load: (force?: boolean) => Promise<void>;
  /** Upload + import a SOFA / BRAS file (job polled until done); resolves with the new record. */
  importFile: (
    file: File,
    name: string,
    sofaSource?: string,
    onProgress?: (progress: number, statusText: string) => void,
  ) => Promise<DirectivityRecord>;
  rename: (id: string, name: string) => Promise<DirectivityRecord>;
  remove: (id: string) => Promise<void>;
  setSnapshot: (records: DirectivityRecord[]) => void;

  // ── Dialog UI (transient) ──
  dialog: DirectivityDialog | null;
  openImport: (options?: Omit<Extract<DirectivityDialog, { kind: 'import' }>, 'kind'>) => void;
  openManager: () => void;
  closeDialog: () => void;
}

const byName = (a: DirectivityRecord, b: DirectivityRecord) => a.name.localeCompare(b.name);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const useDirectivityStore = create<DirectivityStoreState>()(
  devtools(
    (set, get) => ({
      presets: [],
      library: [],
      snapshot: [],
      status: 'idle',
      error: null,

      load: async (force = false) => {
        const { status } = get();
        if (!force && (status === 'loading' || status === 'ready')) return;
        set({ status: 'loading', error: null }, false, 'directivity/loadStart');
        try {
          const records = await apiService.listDirectivities();
          set(
            {
              presets: records.filter((r) => r.origin === 'builtin'),
              library: records.filter((r) => r.origin !== 'builtin').sort(byName),
              status: 'ready',
            },
            false,
            'directivity/loaded',
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Failed to load directivities';
          console.error('[directivityStore] load:', e);
          set({ status: 'error', error: message }, false, 'directivity/loadError');
        }
      },

      importFile: async (file, name, sofaSource, onProgress) => {
        const { job_id } = await apiService.importDirectivity(file, name, sofaSource);
        for (;;) {
          const status = await apiService.getDirectivityImportStatus(job_id);
          onProgress?.(status.progress, status.statusText);
          if (status.completed) {
            if (status.error || !status.directivity) throw new Error(status.error || 'Import failed');
            const record = status.directivity;
            set((s) => ({ library: [...s.library, record].sort(byName) }), false, 'directivity/imported');
            return record;
          }
          await sleep(DIRECTIVITY.IMPORT_POLL_INTERVAL_MS);
        }
      },

      rename: async (id, name) => {
        const updated = await apiService.renameDirectivity(id, name);
        set(
          (s) => ({ library: s.library.map((r) => (r.id === id ? updated : r)).sort(byName) }),
          false,
          'directivity/rename',
        );
        return updated;
      },

      remove: async (id) => {
        await apiService.deleteDirectivity(id);
        set(
          (s) => ({
            library: s.library.filter((r) => r.id !== id),
            snapshot: s.snapshot.filter((r) => r.id !== id),
          }),
          false,
          'directivity/remove',
        );
      },

      setSnapshot: (records) => set({ snapshot: records }, false, 'directivity/setSnapshot'),

      dialog: null,
      openImport: (options = {}) => set({ dialog: { kind: 'import', ...options } }, false, 'directivity/openImport'),
      openManager: () => set({ dialog: { kind: 'manager' } }, false, 'directivity/openManager'),
      closeDialog: () =>
        set(
          (s) => ({
            dialog: s.dialog?.kind === 'import' && s.dialog.returnToManager ? { kind: 'manager' } : null,
          }),
          false,
          'directivity/closeDialog',
        ),
    }),
    { name: 'DirectivityStore' },
  ),
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isLibraryDirectivityId(id: string | null | undefined): id is string {
  return !!id && id.startsWith(DIRECTIVITY.ID_PREFIX);
}

export function isAnalyticalDirectivityId(id: string): boolean {
  return DIRECTIVITY.ANALYTICAL_PRESETS.some((p) => p.id === id);
}

/** Omnidirectional reference (no pattern, identity orientation). */
export function omniDirectivity(): SoundDirectivity {
  return { id: DIRECTIVITY.OMNI_ID, yaw: 0, pitch: 0, roll: 0 };
}

/** Record of a directivity id: presets, then my library, then the soundscape snapshot. */
export function findDirectivity(id: string): DirectivityRecord | undefined {
  const { presets, library, snapshot } = useDirectivityStore.getState();
  return presets.find((r) => r.id === id) ?? library.find((r) => r.id === id) ?? snapshot.find((r) => r.id === id);
}

/** True when `id` can be sent to the backend from this client (built-in, mine or shared). */
export function isResolvableDirectivityId(id: string): boolean {
  return isAnalyticalDirectivityId(id) || findDirectivity(id) !== undefined;
}

/** Display label of a directivity id (falls back to the analytical preset table, then the id). */
export function directivityLabel(id: string | undefined): string {
  if (!id || id === DIRECTIVITY.OMNI_ID) return DIRECTIVITY.ANALYTICAL_PRESETS[0].label;
  return findDirectivity(id)?.name ?? DIRECTIVITY.ANALYTICAL_PRESETS.find((p) => p.id === id)?.label ?? id;
}

/** Library records (deduplicated) among `ids` — the soundscape snapshot of used directivities. */
export function directivityRecordsFor(ids: Iterable<string | undefined>): DirectivityRecord[] {
  const records: DirectivityRecord[] = [];
  for (const id of new Set(ids)) {
    if (!isLibraryDirectivityId(id)) continue;
    const record = findDirectivity(id);
    if (record) records.push({ ...record, origin: 'shared' });
  }
  return records.sort((a, b) => a.id.localeCompare(b.id));
}
