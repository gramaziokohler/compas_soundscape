'use client';

import { CardChipGroup } from '@/components/ui/CardChipGroup';
import { useAudioControlsStore } from '@/store';
import { isVariedCategory } from '@/lib/audio/utils/clip-variation';
import { CLIP_VARIATION } from '@/utils/constants';

export interface SoundVariationChipsProps {
  /** Primary (variant A) sound id — the track id the variation is keyed by. */
  trackId: string;
  /** Sound category; speech and background beds are never varied (no chips). */
  category: string | undefined;
  /** Generated (blue) card styling. */
  onBlueBackground?: boolean;
}

const LABELS = CLIP_VARIATION.MODES.map((m) => m.label);
const TITLES = Object.fromEntries(CLIP_VARIATION.MODES.map((m) => [m.label, m.title]));

/**
 * Off / Subtle / Strong chips on a sound card: how much each occurrence of the
 * sound varies in pitch and level (lib/audio/utils/clip-variation.ts). Single
 * occurrences are adjusted from the DAW clip's right-click menu. Only pitch and
 * level change — never the clip positions on the timeline.
 */
export function SoundVariationChips({ trackId, category, onBlueBackground = false }: SoundVariationChipsProps) {
  const mode = useAudioControlsStore((s) => s.soundVariationModes[trackId]) ?? CLIP_VARIATION.DEFAULT_MODE;
  const setMode = useAudioControlsStore((s) => s.setSoundVariationMode);
  if (!isVariedCategory(category)) return null;

  const current = CLIP_VARIATION.MODES.find((m) => m.value === mode) ?? CLIP_VARIATION.MODES[1];

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span
        className={`text-[10px] ${onBlueBackground ? '' : 'text-secondary-hover'}`}
        style={onBlueBackground ? { color: 'var(--color-on-blue-muted)' } : undefined}
        title="How much each occurrence of this sound varies in pitch and level"
      >
        Variation
      </span>
      <CardChipGroup
        options={LABELS}
        selected={[current.label]}
        titles={TITLES}
        mode="single"
        onChange={([label]) => {
          const picked = CLIP_VARIATION.MODES.find((m) => m.label === label);
          if (picked) setMode(trackId, picked.value);
        }}
        ariaLabel="Variation between occurrences"
        onBlueBackground={onBlueBackground}
      />
    </div>
  );
}
