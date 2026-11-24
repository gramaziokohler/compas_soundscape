'use client';

import { ChipToggleGroup } from '@/components/ui/ChipToggleGroup';
import { useAudioControlsStore } from '@/store';
import { isVariedCategory } from '@/lib/audio/utils/clip-variation';
import type { ClipVariationMode } from '@/types/audio';
import { CLIP_VARIATION } from '@/utils/constants';

export interface SoundVariationChipsProps {
  /** Primary (variant A) sound id — the track id the variation is keyed by. */
  trackId: string;
  /** Sound category; speech and background beds are never varied (no chips). */
  category: string | undefined;
}

const LABELS = CLIP_VARIATION.MODES.map((m) => m.label);

/**
 * Off / Subtle / Strong chips on a sound card: how much each occurrence of the
 * sound varies in pitch and level (lib/audio/utils/clip-variation.ts). Single
 * occurrences are adjusted from the DAW clip's right-click menu.
 */
export function SoundVariationChips({ trackId, category }: SoundVariationChipsProps) {
  const mode = useAudioControlsStore((s) => s.soundVariationModes[trackId]) ?? CLIP_VARIATION.DEFAULT_MODE;
  const setMode = useAudioControlsStore((s) => s.setSoundVariationMode);
  if (!isVariedCategory(category)) return null;

  const current = CLIP_VARIATION.MODES.find((m) => m.value === mode) ?? CLIP_VARIATION.MODES[1];
  const select = (labels: string[]) => {
    // Clicking the active chip again goes back to the default range.
    const picked = CLIP_VARIATION.MODES.find((m) => m.label === labels[0]);
    setMode(trackId, (picked?.value ?? CLIP_VARIATION.DEFAULT_MODE) as ClipVariationMode);
  };

  return (
    <div className="card-field" title={`Variation between occurrences — ${current.title}`}>
      <span className="card-label">Variation</span>
      <ChipToggleGroup
        options={LABELS}
        selected={[current.label]}
        onChange={select}
        mode="single"
        ariaLabel="Variation between occurrences"
      />
    </div>
  );
}
