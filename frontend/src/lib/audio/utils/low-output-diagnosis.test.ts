import { describe, it, expect } from 'vitest';
import { diagnoseLowOutput, type LowOutputContext } from './low-output-diagnosis';
import { AudioMode, type OutputDiagnostics, type OutputSourceDiagnostics } from '@/types/audio';

const ctx: LowOutputContext = { normalizeEnabled: false, timelineOpen: false };

const src = (over: Partial<OutputSourceDiagnostics> = {}): OutputSourceDiagnostics => ({
  id: 's1',
  position: { x: 0, y: 0, z: 0 },
  level: 0.5,
  muted: false,
  distance: 2,
  ir: null,
  ...over,
});

const diag = (over: Partial<OutputDiagnostics> = {}): OutputDiagnostics => ({
  contextState: 'running',
  outputDbfs: -60,
  masterVolume: 1,
  mode: AudioMode.ANECHOIC,
  sources: [src()],
  ...over,
});

describe('diagnoseLowOutput', () => {
  it('reports a suspended context before anything else', () => {
    expect(diagnoseLowOutput(diag({ contextState: 'suspended', masterVolume: 0 }), ctx)?.id).toBe('context-suspended');
  });

  it('returns null when nothing is playing', () => {
    expect(diagnoseLowOutput(diag({ sources: [] }), ctx)).toBeNull();
  });

  it('flags a muted master volume', () => {
    const hint = diagnoseLowOutput(diag({ masterVolume: 0 }), ctx);
    expect(hint?.id).toBe('master-low');
    expect(hint?.action?.kind).toBe('raise-master');
  });

  it('flags all playing sounds muted', () => {
    const hint = diagnoseLowOutput(diag({ sources: [src({ muted: true }), src({ id: 's2', muted: true })] }), ctx);
    expect(hint?.id).toBe('all-muted');
    expect(hint?.action?.kind).toBe('unmute-all');
  });

  it('flags quiet tracks and only offers the timeline when it is closed', () => {
    const quiet = diag({ sources: [src({ level: 0.001 })] });
    expect(diagnoseLowOutput(quiet, ctx)?.id).toBe('tracks-quiet');
    expect(diagnoseLowOutput(quiet, { ...ctx, timelineOpen: true })?.action).toBeNull();
  });

  it('flags sounds silenced for being outside the simulation', () => {
    const d = diag({
      mode: AudioMode.AMBISONIC_IR,
      sources: [src({ distance: null, ir: { state: 'silenced', gainDb: -Infinity } })],
    });
    expect(diagnoseLowOutput(d, ctx)?.id).toBe('out-of-simulation');
  });

  it('suggests normalization for low-energy IRs, and IR gain once it is on', () => {
    const d = diag({
      mode: AudioMode.AMBISONIC_IR,
      sources: [src({ distance: null, ir: { state: 'convolved', gainDb: -45 } })],
    });
    expect(diagnoseLowOutput(d, ctx)?.action?.kind).toBe('normalize-irs');
    const normalized = diagnoseLowOutput(d, { ...ctx, normalizeEnabled: true });
    expect(normalized?.id).toBe('low-ir');
    expect(normalized?.action).toBeNull();
  });

  it('ignores healthy IRs', () => {
    const d = diag({
      mode: AudioMode.AMBISONIC_IR,
      sources: [src({ distance: null, ir: { state: 'convolved', gainDb: -6 } })],
    });
    expect(diagnoseLowOutput(d, ctx)?.id).toBe('generic');
  });

  it('flags a far camera and targets the nearest audible sound', () => {
    const d = diag({
      sources: [
        src({ id: 'far', distance: 80, position: { x: 80, y: 0, z: 0 } }),
        src({ id: 'near', distance: 30, position: { x: 30, y: 0, z: 0 } }),
        src({ id: 'muted', distance: 1, muted: true }),
      ],
    });
    const hint = diagnoseLowOutput(d, ctx);
    expect(hint?.id).toBe('too-far');
    expect(hint?.target).toEqual({ x: 30, y: 0, z: 0 });
  });
});
