import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModelVersionStore } from './modelVersionStore';

/** Minimal in-memory localStorage (vitest runs in Node). */
function stubLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  });
}

const store = () => useModelVersionStore.getState();

beforeEach(() => {
  stubLocalStorage();
  // A model with an already-fetched history (no network in the test).
  useModelVersionStore.setState({
    modelId: 'model-1',
    versions: [
      { id: 'v2', number: 2, is_latest: true },
      { id: 'v1', number: 1, is_latest: false },
    ],
    versionsStatus: 'ready',
    sessionBaseVersionId: null,
    previousVersionId: null,
    banner: null,
    dismissedBannerKey: null,
  });
});

describe('"vN was loaded" banner', () => {
  it('shows only the first time a version is opened', () => {
    store().onVersionLoaded('v1'); // first open of the model: nothing to compare
    expect(store().banner).toBeNull();

    store().setSessionBaseVersion('model-1', 'v1');
    store().onVersionLoaded('v2'); // v2 never opened in this browser
    expect(store().banner).toMatchObject({ kind: 'loaded', fromVersionId: 'v1', toVersionId: 'v2', reason: 'session' });

    // Refresh: the saved session still points at v1, but v2 was already seen.
    useModelVersionStore.setState({ banner: null, sessionBaseVersionId: 'v1' });
    store().onVersionLoaded('v2');
    expect(store().banner).toBeNull();
  });

  it('stays quiet when switching back and forth between versions already seen', () => {
    store().onVersionLoaded('v2');
    store().switchToVersion('v1', 'v2');
    store().onVersionLoaded('v1'); // first time on v1 → introduced
    expect(store().banner).toMatchObject({ kind: 'loaded', reason: 'switch', toVersionId: 'v1' });

    store().switchToVersion('v2', 'v1');
    store().onVersionLoaded('v2'); // v2 already seen
    expect(store().banner).toBeNull();
  });
});
