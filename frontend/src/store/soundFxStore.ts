/**
 * Foley FX editor store.
 *
 * Live editing state keyed by soundId. Domain persistence lives on the
 * SoundEvent (`fx` / `fx_url` / `fx_enabled`) via soundscape.json — this store
 * is not written to localStorage.
 */

import { create } from 'zustand';
import { temporal } from 'zundo';
import { devtools } from 'zustand/middleware';
import {
  copyFxChain,
  createDefaultInstance,
  emptyFxChain,
  sanitizeFxChain,
} from '@/lib/audio/fx/fx-defaults';
import type { FxChain, FxInstance, FxParams, FxRegion, FxType } from '@/lib/audio/fx/fx-types';

export const soundFxPartialize = (state: SoundFxStoreState) => ({
  chains: state.chains,
  expandedId: state.expandedId,
});

interface SoundFxState {
  chains: Record<string, FxChain>;
  expandedId: string | null;
}

interface SoundFxActions {
  ensureChain: (soundId: string, from?: FxChain | null) => void;
  setChain: (soundId: string, chain: FxChain) => void;
  addInstance: (soundId: string, type: FxType) => void;
  removeInstance: (soundId: string, instanceId: string) => void;
  reorderInstance: (soundId: string, from: number, to: number) => void;
  toggleInstance: (soundId: string, instanceId: string, enabled: boolean) => void;
  patchInstanceParams: (soundId: string, instanceId: string, params: FxParams) => void;
  setRegions: (soundId: string, regions: FxRegion[]) => void;
  setOutputGainDb: (soundId: string, db: number) => void;
  setExpandedId: (instanceId: string | null) => void;
  copyChainTo: (fromSoundId: string, toSoundIds: string[]) => void;
  clearChain: (soundId: string) => void;
}

export type SoundFxStoreState = SoundFxState & SoundFxActions;

function getOrEmpty(chains: Record<string, FxChain>, soundId: string): FxChain {
  return chains[soundId] ?? emptyFxChain();
}

export const useSoundFxStore = create<SoundFxStoreState>()(
  temporal(
    devtools(
      (set, get) => ({
        chains: {},
        expandedId: null,

        ensureChain: (soundId, from) => {
          if (get().chains[soundId]) return;
          set(
            { chains: { ...get().chains, [soundId]: from ? sanitizeFxChain(from) : emptyFxChain() } },
            false,
            'fx/ensureChain',
          );
        },

        setChain: (soundId, chain) => {
          set(
            { chains: { ...get().chains, [soundId]: sanitizeFxChain(chain) } },
            false,
            'fx/setChain',
          );
        },

        addInstance: (soundId, type) => {
          const chain = getOrEmpty(get().chains, soundId);
          const inst = createDefaultInstance(type);
          set(
            {
              chains: {
                ...get().chains,
                [soundId]: { ...chain, instances: [...chain.instances, inst] },
              },
              expandedId: inst.instanceId,
            },
            false,
            'fx/addInstance',
          );
        },

        removeInstance: (soundId, instanceId) => {
          const chain = getOrEmpty(get().chains, soundId);
          set(
            {
              chains: {
                ...get().chains,
                [soundId]: {
                  ...chain,
                  instances: chain.instances.filter((i) => i.instanceId !== instanceId),
                },
              },
              expandedId: get().expandedId === instanceId ? null : get().expandedId,
            },
            false,
            'fx/removeInstance',
          );
        },

        reorderInstance: (soundId, from, to) => {
          const chain = getOrEmpty(get().chains, soundId);
          if (from === to || from < 0 || to < 0 || from >= chain.instances.length) return;
          const next = [...chain.instances];
          const [moved] = next.splice(from, 1);
          if (!moved) return;
          next.splice(Math.min(to, next.length), 0, moved);
          set(
            { chains: { ...get().chains, [soundId]: { ...chain, instances: next } } },
            false,
            'fx/reorder',
          );
        },

        toggleInstance: (soundId, instanceId, enabled) => {
          const chain = getOrEmpty(get().chains, soundId);
          set(
            {
              chains: {
                ...get().chains,
                [soundId]: {
                  ...chain,
                  instances: chain.instances.map((i) =>
                    i.instanceId === instanceId ? { ...i, enabled } as FxInstance : i,
                  ),
                },
              },
            },
            false,
            'fx/toggleInstance',
          );
        },

        patchInstanceParams: (soundId, instanceId, params) => {
          const chain = getOrEmpty(get().chains, soundId);
          set(
            {
              chains: {
                ...get().chains,
                [soundId]: {
                  ...chain,
                  instances: chain.instances.map((i) =>
                    i.instanceId === instanceId ? { ...i, params } as FxInstance : i,
                  ),
                },
              },
            },
            false,
            'fx/patchParams',
          );
        },

        setRegions: (soundId, regions) => {
          const chain = getOrEmpty(get().chains, soundId);
          set(
            { chains: { ...get().chains, [soundId]: { ...chain, regions } } },
            false,
            'fx/setRegions',
          );
        },

        setOutputGainDb: (soundId, db) => {
          const chain = getOrEmpty(get().chains, soundId);
          set(
            { chains: { ...get().chains, [soundId]: { ...chain, outputGainDb: db } } },
            false,
            'fx/setOutputGain',
          );
        },

        setExpandedId: (instanceId) => {
          set({ expandedId: instanceId }, false, 'fx/setExpandedId');
        },

        copyChainTo: (fromSoundId, toSoundIds) => {
          const source = get().chains[fromSoundId];
          if (!source) return;
          const next = { ...get().chains };
          for (const id of toSoundIds) {
            if (id === fromSoundId) continue;
            next[id] = copyFxChain(source);
          }
          set({ chains: next }, false, 'fx/copyChainTo');
        },

        clearChain: (soundId) => {
          const next = { ...get().chains };
          delete next[soundId];
          set({ chains: next }, false, 'fx/clearChain');
        },
      }),
      { name: 'soundFxStore' },
    ),
    { limit: 100 },
  ),
);
