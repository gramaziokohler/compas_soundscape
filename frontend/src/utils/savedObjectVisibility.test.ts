import { beforeEach, describe, expect, it, vi } from 'vitest';

// The viewer cannot load in Node; the stores only reference its extension classes.
vi.mock('@speckle/viewer', () => ({
  FilteringExtension: class {},
  CameraController: class {},
  SelectionExtension: class {},
  Viewer: class {},
}));

import { useSpeckleStore } from '@/store';
import type { AnalysisConfig } from '@/types/analysis';
import type { SavedObjectVisibility } from '@/types/card';
import {
  buildSavedVisibilityRows,
  describeSavedObjectVisibility,
  normalizeSavedObjectVisibility,
} from './savedObjectVisibility';
import {
  buildAnalysisStateSave,
  deserializeObjectVisibility,
  restoreAnalysisState,
  serializeObjectVisibility,
} from './soundscape-serializer';

const view = (over: Partial<SavedObjectVisibility> = {}): SavedObjectVisibility => ({
  hiddenIds: [],
  isolatedIds: [],
  excludedIds: [],
  ...over,
});

describe('speckleStore visibility snapshot', () => {
  beforeEach(() => {
    useSpeckleStore.getState().resetUserVisibility();
  });

  it('captures hide / isolate / exclude intent but not the card auto-hides', () => {
    const s = useSpeckleStore.getState();
    s.hideUserObjects(['a', 'b']);
    s.isolateUserObjects(['iso']);
    s.addAcousticExplorerHiddenId('manual');
    s.syncAutoHiddenIds('card-1', ['auto-1', 'auto-2']);

    const snap = useSpeckleStore.getState().getVisibilitySnapshot();
    expect([...snap.hiddenIds].sort()).toEqual(['a', 'b']);
    expect(snap.isolatedIds).toEqual(['iso']);
    expect(snap.excludedIds).toEqual(['manual']);
  });

  it('replaces the intent sets on apply and keeps live auto-hides', () => {
    const s = useSpeckleStore.getState();
    s.hideUserObjects(['old']);
    s.syncAutoHiddenIds('card-1', ['auto-1']);

    useSpeckleStore.getState().applyVisibilitySnapshot(view({ hiddenIds: ['c'], excludedIds: ['n'] }));

    const state = useSpeckleStore.getState();
    expect(state.userHiddenIds).toEqual(['c']);
    expect(state.userIsolatedIds).toEqual([]);
    expect([...state.acousticExplorerHiddenIds].sort()).toEqual(['auto-1', 'n']);
    // Round trip: the auto-hide is still not part of a re-captured snapshot.
    expect(state.getVisibilitySnapshot().excludedIds).toEqual(['n']);
  });
});

describe('saved view helpers', () => {
  it('summarises the saved view for the toast', () => {
    expect(describeSavedObjectVisibility(view())).toBe('Saved object visibility: all visible');
    expect(describeSavedObjectVisibility(view({ hiddenIds: ['a', 'b'] }))).toBe(
      'Saved object visibility: 2 hidden, 0 isolated',
    );
    expect(describeSavedObjectVisibility(view({ excludedIds: ['x'] }))).toBe(
      'Saved object visibility: 0 hidden, 0 isolated, 1 excluded',
    );
  });

  it('offers Clear only when a view is saved', () => {
    const noop = () => {};
    const none = buildSavedVisibilityRows({ saved: undefined, onSave: noop, onClear: noop });
    expect(none.map((r) => r.key)).toEqual(['save-object-visibility']);
    expect(none[0].isActive).toBe(false);

    const some = buildSavedVisibilityRows({ saved: view(), onSave: noop, onClear: noop });
    expect(some.map((r) => r.key)).toEqual(['save-object-visibility', 'clear-object-visibility']);
    expect(some[0].isActive).toBe(true);
  });

  it('normalises loaded JSON defensively', () => {
    expect(normalizeSavedObjectVisibility(null)).toBeUndefined();
    expect(normalizeSavedObjectVisibility({ hiddenIds: ['a', 3], isolatedIds: 'x' })).toEqual(
      view({ hiddenIds: ['a'] }),
    );
  });
});

describe('saved view persistence', () => {
  it('round-trips through the snake_case persisted shape', () => {
    const v = view({ hiddenIds: ['a'], isolatedIds: ['b'], excludedIds: ['c'] });
    const saved = serializeObjectVisibility(v);
    expect(saved).toEqual({ hidden_ids: ['a'], isolated_ids: ['b'], excluded_ids: ['c'] });
    expect(deserializeObjectVisibility(saved)).toEqual(v);
    expect(serializeObjectVisibility(undefined)).toBeUndefined();
    expect(deserializeObjectVisibility(undefined)).toBeUndefined();
  });

  it('round-trips on a scene (analysis) card', () => {
    const v = view({ hiddenIds: ['a', 'b'], excludedIds: ['c'] });
    const config = { type: 'freeform', display_name: 'Scene', savedObjectVisibility: v } as unknown as AnalysisConfig;
    const { analysis_state } = buildAnalysisStateSave([config], [], 0);
    expect(analysis_state.configs[0].saved_object_visibility).toEqual({
      hidden_ids: ['a', 'b'],
      isolated_ids: [],
      excluded_ids: ['c'],
    });

    const restored = restoreAnalysisState(analysis_state);
    expect(restored.analysisConfigs[0].savedObjectVisibility).toEqual(v);
  });

  it('leaves a scene without a saved view untouched', () => {
    const config = { type: 'freeform', display_name: 'Scene' } as unknown as AnalysisConfig;
    const { analysis_state } = buildAnalysisStateSave([config], [], 0);
    expect(analysis_state.configs[0].saved_object_visibility).toBeUndefined();
    expect(restoreAnalysisState(analysis_state).analysisConfigs[0].savedObjectVisibility).toBeUndefined();
  });
});
