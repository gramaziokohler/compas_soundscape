/**
 * ResonanceContent Component
 *
 * Renders Resonance Audio controls for a simulation card.
 */

'use client';

import { ResonanceAudioControls } from '@/components/layout/sidebar/acoustics/ResonanceAudioControls';
import type { ResonanceSimulationConfig } from '@/types/acoustics';

interface ResonanceContentProps {
  config: ResonanceSimulationConfig;
}

export function ResonanceContent({ config }: ResonanceContentProps) {
  return <ResonanceAudioControls config={config} />;
}
