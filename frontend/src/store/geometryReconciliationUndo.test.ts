import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The viewer cannot load in Node; the stores only reference its extension classes.
vi.mock('@speckle/viewer', () => ({
  FilteringExtension: class {},
  CameraController: class {},
  SelectionExtension: class {},
  Viewer: class {},
}));
import {
  useSoundscapeStore,
  beginUndoInteraction,
  endUndoInteraction,
  clearUndoHistory,
  globalUndo,
  globalRedo,
  runWithoutUndo,
} from '@/store';
import { rebaseGeometryReconciliation, type EntityReconciliation } from './geometryReconciliationUndo';

function interact(fn: () => void) {
  beginUndoInteraction();
  fn();
  endUndoInteraction();
  vi.runAllTimers();
}

const step = (fn: () => void) => { fn(); vi.runAllTimers(); };

const wallV1 = { id: 'hashA1', nodeId: 'hashA1', applicationId: 'wall-guid', index: 0, name: 'Wall', position: [0, 0, 0], bounds: { center: [0, 0, 0] } };
const wallV2 = { ...wallV1, id: 'hashA2', nodeId: 'hashA2', position: [1, 0, 0], bounds: { center: [1, 0, 0] } };

const sound = () => useSoundscapeStore.getState().generatedSounds[0];
const entities = () => useSoundscapeStore.getState().soundConfigs[0]?.entities;

/** Card 0 with one free sound at [5,5,5], then linked to the v1 wall, then a prompt edit. */
function setupLinkedCard() {
  interact(() => useSoundscapeStore.getState().handleAddConfig('text-to-audio'));
  interact(() => useSoundscapeStore.setState({
    generatedSounds: [{ id: 's1', prompt_index: 0, position: [5, 5, 5] }],
    soundscapeData: [{ id: 's1', prompt_index: 0, position: [5, 5, 5] }],
  }));
  interact(() => useSoundscapeStore.getState().handleAttachSoundToEntity(0, wallV1));
  interact(() => useSoundscapeStore.getState().handleUpdateConfig(0, 'prompt', 'rain'));
}

beforeEach(() => {
  vi.useFakeTimers();
  clearUndoHistory();
  useSoundscapeStore.setState({ soundConfigs: [], generatedSounds: [], soundscapeData: null });
  clearUndoHistory();
  vi.runAllTimers();
});
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
});

describe('geometry reconciliation × undo/redo', () => {
  it('a moved object never jumps back on undo, and undoing the link still unlinks', () => {
    setupLinkedCard();
    expect(sound().position).toEqual([0, 0, 0]);

    // New model version: the wall moved. Reconciliation is a load, not a step.
    runWithoutUndo(() => {
      useSoundscapeStore.getState().handleUpdateConfig(0, 'entities', [wallV2]);
      useSoundscapeStore.getState().updateSoundPosition('s1', [1, 0, 0]);
    });
    const outcome: EntityReconciliation = new Map([['wall-guid', wallV2], ['hashA1', wallV2]]);
    rebaseGeometryReconciliation(outcome);
    vi.runAllTimers();

    step(globalUndo); // undo the prompt edit
    expect(useSoundscapeStore.getState().soundConfigs[0].prompt).toBe('');
    expect(entities()?.[0]?.bounds?.center).toEqual([1, 0, 0]);
    expect(sound().position).toEqual([1, 0, 0]);

    step(globalUndo); // undo the link itself
    expect(entities()).toBeUndefined();
    expect(sound().position).toEqual([5, 5, 5]);

    step(globalRedo); // redo the link → on the MOVED wall
    expect(entities()?.[0]?.bounds?.center).toEqual([1, 0, 0]);
    expect(sound().position).toEqual([1, 0, 0]);

    step(globalRedo); // redo the prompt edit
    expect(useSoundscapeStore.getState().soundConfigs[0].prompt).toBe('rain');
    expect(sound().position).toEqual([1, 0, 0]);
  });

  it('a deleted object stays unlinked through undo / redo of later edits', () => {
    setupLinkedCard();

    // New model version: the wall was deleted → the card is detached (a load).
    runWithoutUndo(() => useSoundscapeStore.getState().handleDetachSoundFromEntity(0));
    rebaseGeometryReconciliation(new Map([['wall-guid', null], ['hashA1', null]]));
    vi.runAllTimers();

    step(globalUndo); // undo the prompt edit — must not resurrect the link
    expect(useSoundscapeStore.getState().soundConfigs[0].prompt).toBe('');
    expect(entities()).toBeUndefined();
    expect(sound().entity_index).toBeUndefined();

    step(globalRedo);
    expect(useSoundscapeStore.getState().soundConfigs[0].prompt).toBe('rain');
    expect(entities()).toBeUndefined();
  });
});
