/**
 * Custom Material Store
 *
 * The current user's library of user-defined acoustic materials
 * (backend `/api/me/materials`, keyed by user identity — follows the user
 * across workspaces) plus the read-only snapshot of custom materials embedded
 * in the loaded soundscape (so a shared workspace's materials resolve for
 * collaborators without entering their library).
 *
 * Not undoable and not persisted: the backend is the source of truth for the
 * library, `soundscape.json` (`custom_materials`) for the snapshot.
 *
 * Producer : useAvailableAcousticMaterials (load), CustomMaterialDialog /
 *            CustomMaterialsManager (create / update / remove),
 *            soundscape load (setSnapshot)
 * Consumers: useAvailableAcousticMaterials (merged picker list),
 *            simulationRequest (inline coefficients), soundscape save (snapshot)
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { apiService } from '@/services/api';
import { isShareViewActive } from '@/store/shareViewStore';
import { CUSTOM_MATERIAL } from '@/utils/constants';
import type {
  AcousticMaterial,
  CustomMaterialCoefficients,
  CustomMaterialInput,
  CustomMaterialRecord,
} from '@/types/materials';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Which custom-material dialog is open (one host renders it — see CustomMaterialDialogsHost). */
export type CustomMaterialDialog =
  | {
      kind: 'editor';
      /** Material being edited; omitted when creating. */
      materialId?: string;
      /** Material whose name/coefficients prefill a new material (duplicate / "start from"). */
      templateId?: string;
      /** Called with the saved material id (e.g. assign it to the picker's surfaces). */
      onSaved?: (materialId: string) => void;
      /** Reopen the manager when the editor closes (editor opened from the manager). */
      returnToManager?: boolean;
    }
  | { kind: 'manager' };

export interface CustomMaterialStoreState {
  /** My materials, sorted by name. */
  library: CustomMaterialRecord[];
  /** Custom materials of the loaded soundscape (may belong to another user). */
  snapshot: CustomMaterialRecord[];
  status: LoadStatus;
  error: string | null;

  /** Fetch the library once (pass `force` to refetch). */
  load: (force?: boolean) => Promise<void>;
  create: (input: CustomMaterialInput) => Promise<CustomMaterialRecord>;
  update: (id: string, input: CustomMaterialInput) => Promise<CustomMaterialRecord>;
  remove: (id: string) => Promise<void>;
  setSnapshot: (materials: CustomMaterialRecord[]) => void;

  // ── Dialog UI (transient) ──
  dialog: CustomMaterialDialog | null;
  openEditor: (options?: Omit<Extract<CustomMaterialDialog, { kind: 'editor' }>, 'kind'>) => void;
  openManager: () => void;
  /** Close the open dialog (an editor opened from the manager returns to it). */
  closeDialog: () => void;
}

const byName = (a: CustomMaterialRecord, b: CustomMaterialRecord) => a.name.localeCompare(b.name);

export const useCustomMaterialStore = create<CustomMaterialStoreState>()(
  devtools(
    (set, get) => ({
      library: [],
      snapshot: [],
      status: 'idle',
      error: null,

      load: async (force = false) => {
        const { status } = get();
        if (!force && (status === 'loading' || status === 'ready')) return;
        // The anonymous share view has no library — only the payload's snapshot.
        if (isShareViewActive()) {
          set({ status: 'ready', error: null }, false, 'customMaterial/loaded');
          return;
        }
        set({ status: 'loading', error: null }, false, 'customMaterial/loadStart');
        try {
          const library = await apiService.listCustomMaterials();
          set({ library: [...library].sort(byName), status: 'ready' }, false, 'customMaterial/loaded');
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Failed to load custom materials';
          console.error('[customMaterialStore] load:', e);
          set({ status: 'error', error: message }, false, 'customMaterial/loadError');
        }
      },

      create: async (input) => {
        const created = await apiService.createCustomMaterial(input);
        set((s) => ({ library: [...s.library, created].sort(byName) }), false, 'customMaterial/create');
        return created;
      },

      update: async (id, input) => {
        const updated = await apiService.updateCustomMaterial(id, input);
        set(
          (s) => ({ library: s.library.map((m) => (m.id === id ? updated : m)).sort(byName) }),
          false,
          'customMaterial/update',
        );
        return updated;
      },

      remove: async (id) => {
        await apiService.deleteCustomMaterial(id);
        set(
          (s) => ({
            library: s.library.filter((m) => m.id !== id),
            snapshot: s.snapshot.filter((m) => m.id !== id),
          }),
          false,
          'customMaterial/remove',
        );
      },

      setSnapshot: (materials) => set({ snapshot: materials }, false, 'customMaterial/setSnapshot'),

      dialog: null,
      openEditor: (options = {}) =>
        set({ dialog: { kind: 'editor', ...options } }, false, 'customMaterial/openEditor'),
      openManager: () => set({ dialog: { kind: 'manager' } }, false, 'customMaterial/openManager'),
      closeDialog: () =>
        set(
          (s) => ({
            dialog: s.dialog?.kind === 'editor' && s.dialog.returnToManager ? { kind: 'manager' } : null,
          }),
          false,
          'customMaterial/closeDialog',
        ),
    }),
    { name: 'CustomMaterialStore' },
  ),
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isCustomMaterialId(materialId: string | null | undefined): materialId is string {
  return !!materialId && materialId.startsWith(CUSTOM_MATERIAL.ID_PREFIX);
}

/** Picker-ready material from a custom record. */
export function customRecordToMaterial(record: CustomMaterialRecord, isShared = false): AcousticMaterial {
  return {
    id: record.id,
    name: record.name,
    absorption: record.absorption,
    category: 'Custom',
    description: record.description,
    coeffs: record.coeffs,
    center_freqs: record.center_freqs,
    isCustom: true,
    isShared,
  };
}

/** Definition of a custom id: my library first, then the soundscape snapshot. */
export function findCustomMaterial(materialId: string): CustomMaterialRecord | undefined {
  const { library, snapshot } = useCustomMaterialStore.getState();
  return library.find((m) => m.id === materialId) ?? snapshot.find((m) => m.id === materialId);
}

/** Records of every custom id among `materialIds` that can be resolved (deduplicated). */
export function customMaterialRecordsFor(materialIds: Iterable<string>): CustomMaterialRecord[] {
  const records: CustomMaterialRecord[] = [];
  for (const id of new Set(materialIds)) {
    if (!isCustomMaterialId(id)) continue;
    const record = findCustomMaterial(id);
    if (record) records.push(record);
  }
  return records.sort((a, b) => a.id.localeCompare(b.id));
}

/** `{id: {coeffs, center_freqs}}` of the custom ids among `materialIds` — sent inline to the solvers. */
export function customMaterialDefinitions(
  materialIds: Iterable<string>,
): Record<string, CustomMaterialCoefficients> {
  const defs: Record<string, CustomMaterialCoefficients> = {};
  for (const record of customMaterialRecordsFor(materialIds)) {
    defs[record.id] = { coeffs: record.coeffs, center_freqs: record.center_freqs };
  }
  return defs;
}
