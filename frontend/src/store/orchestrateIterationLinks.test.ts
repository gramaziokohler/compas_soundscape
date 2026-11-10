import { beforeEach, describe, expect, it, vi } from 'vitest';

// The viewer cannot load in Node; the stores only reference its extension classes.
vi.mock('@speckle/viewer', () => ({
  FilteringExtension: class {},
  CameraController: class {},
  SelectionExtension: class {},
  Viewer: class {},
}));
import { useAudioControlsStore } from '@/store';
import type { SoundGenerationConfig } from '@/types';

// One orchestrated card with three iterations authored as variants A, B, A.
const configs = [
  {
    prompt: 'speech',
    orchestrateMeta: {
      orchestrateId: 'o1',
      entryId: 'e1',
      trigger: { type: 'param', expression: ['', '', ''], delay: [0, 0, 0] },
      variants: [1, 2, 1],
      allObjectIds: [],
    },
  },
] as unknown as SoundGenerationConfig[];

const links = () => useAudioControlsStore.getState().iterationLinks;

describe('setOrchestrateIterationLinks', () => {
  beforeEach(() => {
    useAudioControlsStore.setState({
      _generatedSounds: [{ id: 's1', prompt_index: 0 }],
      iterationLinks: {},
      iterationTrims: {},
    });
  });

  it('stamps the authored variants when no link exists yet', () => {
    useAudioControlsStore.getState().setOrchestrateIterationLinks(configs, { preserveExisting: true });
    expect(links()['s1-0']?.variantIndex).toBe(0);
    expect(links()['s1-1']?.variantIndex).toBe(1);
    expect(links()['s1-2']?.variantIndex).toBe(0);
  });

  it('passive re-sync keeps a variant the user picked in the DAW', () => {
    useAudioControlsStore.getState().setOrchestrateIterationLinks(configs);
    useAudioControlsStore.getState().setIterationLink('s1', 0, { variantIndex: 1 });
    useAudioControlsStore.getState().setIterationLink('s1', 2, { variantIndex: 1 });

    useAudioControlsStore.getState().setOrchestrateIterationLinks(configs, { preserveExisting: true });

    expect(links()['s1-0']?.variantIndex).toBe(1);
    expect(links()['s1-1']?.variantIndex).toBe(1);
    expect(links()['s1-2']?.variantIndex).toBe(1);
  });

  it('passive re-sync fills only the missing iterations', () => {
    useAudioControlsStore.getState().setIterationLink('s1', 1, { variantIndex: 0 });
    useAudioControlsStore.getState().setOrchestrateIterationLinks(configs, { preserveExisting: true });
    expect(links()['s1-0']?.variantIndex).toBe(0);
    expect(links()['s1-1']?.variantIndex).toBe(0); // user pick kept (authored B)
    expect(links()['s1-2']?.variantIndex).toBe(0);
  });

  it('an authoritative re-stamp still applies the orchestrator variants', () => {
    useAudioControlsStore.getState().setIterationLink('s1', 0, { variantIndex: 1 });
    useAudioControlsStore.getState().setOrchestrateIterationLinks(configs);
    expect(links()['s1-0']?.variantIndex).toBe(0);
  });
});
