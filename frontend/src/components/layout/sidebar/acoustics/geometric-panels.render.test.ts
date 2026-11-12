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
  return { useAcousticPathsStore: Object.assign(hook, { getState: real.getState, setState: real.setState }) };
});
vi.mock('@/store/uiStore', () => ({ useUIStore: (selector: (s: { globalSoundSpeed: number }) => unknown) => selector({ globalSoundSpeed: 343 }) }));
vi.mock('./AcousticMaterialsSummary', () => ({ AcousticMaterialsSummary: () => null }));
import { defaultHybridSettings } from '@/lib/acoustics/hybrid';
import { AcousticPathsPanel } from './AcousticPathsPanel';
import { GeometricEngineSettings } from './GeometricEngineSettings';
import { HybridSimulationSettings } from './HybridSimulationSettings';
import type { AcousticPathsPayload } from '@/types/acousticPaths';
import type { HybridSimulationConfig } from '@/types/acoustics';
import type { EngineCapabilities } from '@/lib/acoustics/geometric-engine';

const CAPS: EngineCapabilities = {
  default: 'compas_acoustics',
  engines: {
    compas_acoustics: { available: true, modes: ['mono', 'foa', 'hoa'], diffraction: ['off', 'udfa', 'btms'], tails: [], max_ambisonic_order: 3, paths: [] },
    pyroomacoustics: { available: true, modes: ['mono', 'foa'], diffraction: ['off'], tails: [], max_ambisonic_order: 1, paths: [] },
  },
};

const PAYLOAD: AcousticPathsPayload = {
  paths_id: 'p', speed_of_sound: 343, notes: ['The model does not close, so the room\'s own corners do not diffract.'],
  sources: [{ id: 's1', position: [0, 0, 0] }, { id: 's2', position: [5, 0, 0] }],
  receivers: [{ id: 'r1', position: [2, 0, 0] }],
  reflections: { max_order: 2, truncated: false, paths: [{ s: 0, r: 0, order: 1, points: [0, 0, 0, 1, 1, 0, 2, 0, 0], distance: 2.8, delay_ms: 8.2, level_db: -10 }] },
  rays: { n_rays: 1, max_order: 2, duration_ms: 20, rays: [{ s: 0, points: [0, 0, 0, 3, 0, 0] }] },
  diffraction: {
    edges: [
      { id: 0, segment: [1, 0, 0, 1, 0, 2], length: 2, wedge_deg: 0, kind: 'obstacle', excluded: false, used: true },
      { id: 1, segment: [0, 5, 0, 6, 5, 0], length: 6, wedge_deg: 90, kind: 'boundary', excluded: false, used: false },
    ],
    paths: [],
  },
};

const reset = () => useAcousticPathsStore.setState({
  entries: {}, previewConfigId: null, capabilities: CAPS, capabilitiesLoaded: true, playing: false, timeMs: 0, durationMs: 0, edgeEditing: false,
});

const pathsPanel = (over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(AcousticPathsPanel, {
  configId: 'c1', currentSignature: 'sig', onRun: () => undefined, excludedEdges: [], diffraction: 'udfa',
  onExcludedEdgesChange: () => undefined, canEdit: true, ...over,
}));

describe('sound-paths panel', () => {
  beforeEach(reset);

  it('offers to trace before any trace exists', () => {
    const html = pathsPanel();
    expect(html).toContain('Trace paths');
    expect(html).toContain('Reflection order to trace');
    expect(html).not.toContain('Show paths in 3D');
  });

  it('explains why tracing is unavailable instead of offering it', () => {
    const html = pathsPanel({ unavailableReason: 'Sound paths need the compas_acoustics engine.' });
    expect(html).toContain('Sound paths need the compas_acoustics engine.');
    expect(html).not.toContain('Trace paths');
  });

  it('shows progress while tracing', () => {
    useAcousticPathsStore.setState({ entries: { c1: { status: 'running', progress: 40, statusText: 'Tracing image-source paths...', error: null, jobId: 'j', signature: null, payload: null } } });
    const html = pathsPanel();
    expect(html).toContain('Cancel');
    expect(html).toContain('Tracing image-source paths...');
  });

  it('shows a failed trace', () => {
    useAcousticPathsStore.setState({ entries: { c1: { status: 'error', progress: 0, statusText: 'Error', error: 'Worker busy', jobId: null, signature: null, payload: null } } });
    expect(pathsPanel()).toContain('Worker busy');
  });

  it('summarises a trace, flags it outdated and counts the edges switched off', () => {
    useAcousticPathsStore.setState({ entries: { c1: { status: 'done', progress: 100, statusText: 'Done', error: null, jobId: 'j', signature: 'old', payload: PAYLOAD } } });
    const html = pathsPanel({ excludedEdges: [[1, 0, 0, 1, 0, 2]] });
    expect(html).toContain('Re-trace');
    expect(html).toContain('outdated');
    expect(html).toContain('1 edge off');
    expect(html).toContain('2 edges (1 carry a path)');
    expect(html).toContain('own corners do not diffract');
    expect(html).toContain('Show paths in 3D');
    expect(html).not.toContain('Click edges in 3D'); // view controls only once shown in 3D
  });

  it('shows the view controls, the billiard transport and the edge tools when previewed', () => {
    useAcousticPathsStore.setState({
      previewConfigId: 'c1', durationMs: 20,
      entries: { c1: { status: 'done', progress: 100, statusText: 'Done', error: null, jobId: 'j', signature: 'sig', payload: PAYLOAD } },
    });
    const html = pathsPanel({ excludedEdges: [[1, 0, 0, 1, 0, 2]] });
    expect(html).not.toContain('outdated');
    expect(html).toContain('Show up to order');
    expect(html).toContain('Play the billiard');
    expect(html).toContain('1 of 2 edges on');
    expect(html).toContain('Click edges in 3D');
    expect(html).toContain('Only edges with a path');
    expect(html).toContain('All sources'); // two sources: a pair filter
    expect(html).not.toContain('All listeners'); // one listener: nothing to filter
  });

  it('lets a read-only card inspect edges but not edit them', () => {
    useAcousticPathsStore.setState({
      previewConfigId: 'c1',
      entries: { c1: { status: 'done', progress: 100, statusText: 'Done', error: null, jobId: 'j', signature: 'sig', payload: PAYLOAD } },
    });
    const html = pathsPanel({ canEdit: false, diffraction: 'off' });
    expect(html).toContain('2 of 2 edges on');
    expect(html).toContain('edge diffraction is off for this card');
    expect(html).not.toContain('Click edges in 3D');
    expect(html).not.toContain('All off');
  });
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
    const legacy = engine({ simulation_mode: 'hoa', diffraction: 'udfa', engine: 'pyroomacoustics' });
    expect(legacy).toContain('Higher-order ambisonics needs compas_acoustics');
    expect(legacy).toContain('Edge diffraction needs compas_acoustics');
    expect(legacy).not.toContain('Reverb tail'); // the legacy engine has none
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
    expect(html).toContain('measured from the room when the simulation runs');
    expect(html).toContain('Wave part (below the crossover)');
    expect(html).toContain('Geometric part (above the crossover)');
    expect(html).toContain('Length from the room');
    expect(html).not.toContain('Wave IR length'); // automatic by default
    expect(html).not.toContain('Engine</label>'); // always compas_acoustics
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
