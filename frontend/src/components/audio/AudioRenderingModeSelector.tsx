/**
 * Audio Rendering Mode Selector
 *
 * Three-button selector for audio rendering mode:
 * - No Acoustics: Dry signal only (no room acoustics)
 * - ShoeBox Acoustics: Advanced HRTF with room acoustics
 * - Precise Acoustics: User-uploaded impulse response convolution
 *
 * Only one mode can be active at a time.
 */

'use client';

import { CardSelect } from '@/components/ui/CardSelect';

export type AudioRenderingMode = 'anechoic' | 'resonance' | 'precise';

interface AudioRenderingModeSelectorProps {
  currentMode: AudioRenderingMode;
  onModeChange: (mode: AudioRenderingMode) => void;
  className?: string;
}

const OPTIONS = [
  { value: 'anechoic' as const, label: 'No Acoustics' },
  { value: 'resonance' as const, label: 'ShoeBox Acoustics' },
  { value: 'precise' as const, label: 'Precise Acoustics' },
];

export function AudioRenderingModeSelector({
  currentMode,
  onModeChange,
  className = ''
}: AudioRenderingModeSelectorProps) {
  return (
    <CardSelect
      value={currentMode}
      onChange={(v) => onModeChange(v as AudioRenderingMode)}
      options={OPTIONS}
      className={className}
    />
  );
}
