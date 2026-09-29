/**
 * Resolve the audio URL a SoundEvent should currently play / display.
 *
 * When FX is enabled and a bounced file exists, that file is the source of
 * truth for the sidebar waveform, DAW thumbnails, 3D playback, and export.
 * Otherwise the original generated/uploaded URL is used.
 */

export interface SoundAudioRef {
  url?: string | null;
  fx_url?: string | null;
  fx_enabled?: boolean | null;
}

export function resolveSoundAudioUrl(event: SoundAudioRef | null | undefined): string {
  if (!event) return '';
  if (event.fx_enabled && event.fx_url) return event.fx_url;
  return event.url ?? '';
}
