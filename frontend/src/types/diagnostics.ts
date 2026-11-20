/** Audio-engine memory held for simulation IRs (crash probe). */
export interface AudioMemoryStats {
  /** Decoded IRs kept in the orchestrator's irCache. */
  irCacheCount: number;
  irCacheBytes: number;
  /** Shared AmbisonicConvolver banks alive in AmbisonicIRMode. */
  convolverBanks: number;
  /** ConvolverNodes rendering across all banks. */
  convolverNodes: number;
  /** Bytes held by the banks' filters (each bank also copies its filter per channel). */
  convolverFilterBytes: number;
  /** updateSourceIRsForReceiver runs currently in flight (more than 1 = overlapping switches). */
  irRunsInFlight: number;
}

/** Sounds-view point lights (crash probe). */
export interface SoundLightStats {
  total: number;
  visible: number;
}

/** One crash-probe record: a periodic sample or a marked event. */
export interface CrashProbeRecord {
  t: string;
  kind: 'sample' | 'event';
  event?: string;
  data?: Record<string, unknown>;
}
