/**
 * Render smoke tests of the geometric-acoustics panels (server renderer, no DOM): every state a
 * card can be in must render without throwing and show what it promises. Effects do not run here,
 * so this covers the render path only — not the 3D overlay or pointer handling.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAcousticPathsStore } from '@/store/acousticPathsStore';

// The store barrel and the materials summary pull in the Speckle viewer, which does not load
// outside a browser. The panels only need the paths store and the global sound speed.
// Under the server renderer a zustand hook returns the store's INITIAL state, so the mock reads
// the current state instead (what a mounted component would see).
vi.mock('@/store', async () => {
  const { useAcousticPathsStore: real } = await import('@/store/acousticPathsStore');
  type State = ReturnType<typeof real.getState>;
  const hook = <T,>(selector: (s: State) => T): T => selector(real.getState());
  const materials = { materialAssignments: new Map<string, string>(), availableMaterials: [] };
  return {
    useAcousticPathsStore: Object.assign(hook, { getState: real.getState, setState: real.setState }),
    useAcousticMaterialStore: <T,>(selector: (s: typeof materials) => T): T => selector(materials),
  };
});
vi.mock('@/store/uiStore', () => ({ useUIStore: (selector: (s: { globalSoundSpeed: number }) => unknown) => selector({ globalSoundSpeed: 343 }) }));
vi.mock('./AcousticMaterialsSummary', () => ({ AcousticMaterialsSummary: () => null }));
const regionBounds = vi.hoisted(() => ({ current: null as { min: [number, number, number]; max: [number, number, number] } | null }));
vi.mock('@/hooks/useAcousticRegionBounds', () => ({
  useAcousticRegionBounds: () => ({ bounds: regionBounds.current, isAcousticLayer: true }),
}));
import { defaultHybridSettings } from '@/lib/acoustics/hybrid';
import { GeometricEngineSettings } from './GeometricEngineSettings';
import { HybridSimulationSettings } from './HybridSimulationSettings';
import type { HybridSimulationConfig } from '@/types/acoustics';
import type { EngineCapabilities } from '@/lib/acoustics/geometric-engine';

const CAPS: EngineCapabilities = {
  default: 'compas_acoustics',
  engines: {
    compas_acoustics: { available: true, modes: ['mono', 'foa', 'hoa'], diffraction: ['off', 'udfa', 'btms'], tails: [], max_ambisonic_order: 3 },
    pyroomacoustics: { available: true, modes: ['mono', 'foa'], diffraction: ['off'], tails: [], max_ambisonic_order: 1 },
  },
};

const reset = () => useAcousticPathsStore.setState({
  payloads: {}, hovered: null, selected: null, capabilities: CAPS, capabilitiesLoaded: true,
});

const engine = (settings: Record<string, unknown>, over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(GeometricEngineSettings, {
  settings: { simulation_mode: 'mono', ...settings } as never, onChange: () => undefined, isModified: () => false, ...over,
}));

describe('engine settings', () => {
  beforeEach(reset);

  it('shows diffraction for mono and adds the reverb tail for ambisonic output', () => {
    const mono = engine({});
    expect(mono).toContain('Edge diffraction');
    expect(mono).not.toContain('Reverb tail');
    const foa = engine({ simulation_mode: 'foa', tail: 'eyring' });
    expect(foa).toContain('Reverb tail');
    expect(foa).toContain('Diffuse-field decay');
  });

  it('says what the run will change', () => {
    expect(engine({ diffraction: 'btms' })).toContain('BTMS diffraction needs an ambisonic output');
    const praEngine = engine({ simulation_mode: 'hoa', diffraction: 'udfa', engine: 'pyroomacoustics' });
    expect(praEngine).toContain('Higher-order ambisonics needs compas_acoustics');
    expect(praEngine).toContain('Edge diffraction needs compas_acoustics');
    expect(praEngine).not.toContain('Reverb tail'); // engine=pra has no FDN reverb-tail control
    const soaMoments = engine({ simulation_mode: 'hoa', ambisonic_order: 2, tail: 'moments' });
    expect(soaMoments).toContain('tail is first order only');
    expect(engine({ simulation_mode: 'foa', tail: 'moments' })).not.toContain('first order only');
  });

  it('renders before the capabilities are known', () => {
    useAcousticPathsStore.setState({ capabilities: null });
    expect(engine({ simulation_mode: 'foa' })).toContain('Reverb tail');
  });
});

const hybridConfig = (over: Partial<HybridSimulationConfig> = {}): HybridSimulationConfig => ({
  id: 'h1', display_name: 'Hybrid 1', type: 'hybrid', state: 'before-simulation', createdAt: 0,
  settings: defaultHybridSettings(), faceToMaterialMap: new Map(), isRunning: false, progress: 0, status: 'Idle',
  error: null, simulationResults: null, ...over,
} as HybridSimulationConfig);

const hybrid = (config: HybridSimulationConfig) =>
  renderToStaticMarkup(createElement(HybridSimulationSettings, { config, onUpdateConfig: () => undefined }));

describe('hybrid card settings', () => {
  beforeEach(reset);

  it('explains the Schroeder crossover before a run', () => {
    const html = hybrid(hybridConfig());
    expect(html).toContain('× Schroeder frequency');
    expect(html).toContain('predicted from the simulation mesh when the run starts');
    expect(html).toContain('Wave part (below the crossover)');
    expect(html).toContain('Geometric part (above the crossover)');
    expect(html).toContain('Length from the room');
    expect(html).not.toContain('Wave IR length'); // automatic by default
    expect(html).not.toContain('Engine</label>'); // always compas_acoustics
    expect(html).not.toContain('Wave solver up to'); // the wave band follows the crossover
  });

  it('recommends the Eyring estimate of the acoustic layer before a run', () => {
    regionBounds.current = { min: [0, 0, 0], max: [10, 5, 3] };
    try {
      const html = hybrid(hybridConfig());
      expect(html).toContain('Estimated (Eyring, acoustic layer box)');
      const manual = hybrid(hybridConfig({ settings: { ...defaultHybridSettings(), crossover_mode: 'manual' } }));
      expect(manual).toContain('Recommended ≈');
      expect(manual).toContain('>rec<');
    } finally {
      regionBounds.current = null;
    }
  });

  it('offers a frequency for a manual crossover and a length when not automatic', () => {
    const html = hybrid(hybridConfig({ settings: { ...defaultHybridSettings(), crossover_mode: 'manual', crossover_hz: 150, duration: 0.8 } }));
    expect(html).toContain('Crossover frequency');
    expect(html).toContain('Wave below 150 Hz');
    expect(html).toContain('Wave IR length');
  });

  it('reports the last run and warns when the two parts disagree', () => {
    const info = {
      crossover_hz: 234, wave_fmax: 351, schroeder_hz: 234, rt60: 0.41, volume_m3: 30, mode: 'schroeder', factor: 1,
      limited_by: null, notes: ['The wave solver is capped at 300 Hz.'], median_overlap_mismatch_db: 6.5, level_match: false,
    };
    const html = hybrid(hybridConfig({ state: 'completed', hybridInfo: info }));
    expect(html).toContain('Schroeder 234 Hz');
    expect(html).toContain('The wave solver is capped at 300 Hz.');
    expect(html).toContain('6.5 dB louder');
  });
});
