/**
 * Text for the performance meter: the headline value per metric and the detail rows.
 */
import { CRASH_PROBE, PERFORMANCE_METER } from '@/utils/constants';
import { stallMs } from '@/lib/diagnostics/performance-levels';
import type { PerformanceMetricId, PerformanceSample } from '@/types';

const MB_PER_GB = 1024;

function formatMB(mb: number): string {
  return mb >= MB_PER_GB ? `${(mb / MB_PER_GB).toFixed(2)} GB` : `${Math.round(mb)} MB`;
}

function bytesMB(bytes: number): string {
  return formatMB(bytes / CRASH_PROBE.BYTES_PER_MB);
}

/** Headline value per metric ('—' when there is no data). */
export function metricValueText(id: PerformanceMetricId, s: PerformanceSample | null): string {
  if (!s) return '—';
  switch (id) {
    case 'mem':
      return `${s.support.heap ? '' : '~'}${formatMB(s.memoryMB)}`;
    case 'cpu': {
      const stall = Math.round(stallMs(s));
      return s.frames ? `${stall} ms · ${s.frames.fps} fps` : `${stall} ms`;
    }
    case 'dsp':
      return s.audio ? `${s.audio.convolverNodes} conv · ${s.audio.irRunsInFlight} IR loads` : '—';
    case 'gpu':
      if (s.contextLost) return 'context lost';
      return s.gl ? `${s.gl.programs} shaders · +${s.newPrograms}` : '—';
    case 'xrun':
      return s.support.xrun ? `${s.xruns}` : '—';
  }
}

/** Tooltip per metric: what it measures, plus why it may be empty in this browser. */
export function metricTitle(id: PerformanceMetricId, s: PerformanceSample | null): string {
  const base = PERFORMANCE_METER.TITLES[id];
  if (id === 'mem' && s && !s.support.heap) return `${base} (${PERFORMANCE_METER.AUDIO_ONLY_NOTE})`;
  if (id === 'xrun' && s && !s.support.xrun) return `${base} (${PERFORMANCE_METER.NOT_SUPPORTED_NOTE})`;
  return base;
}

/** Detail rows for the expanded panel. */
export function detailRows(s: PerformanceSample | null): Array<[string, string]> {
  if (!s) return [];
  const rows: Array<[string, string]> = [];
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : null;
  if (s.heap) rows.push(['JS heap', `${formatMB(s.heap.usedMB)} / ${formatMB(s.heap.limitMB)}`]);
  if (s.audio) {
    rows.push(['IR cache', `${s.audio.irCacheCount} IRs · ${bytesMB(s.audio.irCacheBytes)} / ${bytesMB(s.audio.irCacheBudgetBytes)}`]);
    rows.push(['Convolver banks', `${s.audio.convolverBanks} · ${bytesMB(s.audio.convolverFilterBytes)}`]);
  }
  rows.push(['Voices playing', `${s.playingVoices}`]);
  if (s.lights) rows.push(['Sounds-view lights', `${s.lights.visible} lit / ${s.lights.total} sounds`]);
  if (s.gl) rows.push(['Geometries · textures', `${s.gl.geometries} · ${s.gl.textures}`]);
  rows.push(['Long tasks (10 s)', s.support.longtask ? `${s.longTasks.count} · worst ${Math.round(s.longTasks.worstMs)} ms` : PERFORMANCE_METER.NOT_SUPPORTED_NOTE]);
  if (s.context) {
    rows.push(['Audio', `${s.context.state} · ${s.context.sampleRate} Hz · ${Math.round((s.context.baseLatency + s.context.outputLatency) * 1000)} ms latency`]);
  }
  if (nav) rows.push(['Device', `${nav.deviceMemory ? `${nav.deviceMemory} GB RAM · ` : ''}${nav.hardwareConcurrency ?? '?'} cores`]);
  return rows;
}
