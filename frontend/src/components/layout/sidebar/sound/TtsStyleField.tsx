'use client';

import { pauseStore, commitStore } from '@/store';
import { ChipToggleGroup } from '@/components/ui/ChipToggleGroup';
import { ModifiedMark } from '@/components/ui/ModifiedMark';
import { TTS_STYLE } from '@/utils/constants';
import { activeStylePresetLabels, applyStylePresetLabels } from '@/utils/ttsStyle';

export interface TtsStyleFieldProps {
  /** Current delivery style (`config.voice_style`). */
  value: string | undefined;
  /** Called with the new style (undefined = neutral). */
  onChange: (value: string | undefined) => void;
  /** Mark the label as edited since the last generation. */
  modified?: boolean;
}

const PRESET_LABELS = TTS_STYLE.PRESETS.map((p) => p.label);

/**
 * Delivery style of a TTS card: free text plus one-click helper chips
 * (TTS_STYLE.PRESETS) that toggle their phrase in the text. Shown on pending and
 * generated speech cards; editing it marks the card for "Regenerate".
 *
 * Usage:
 * ```tsx
 * <TtsStyleField value={config.voice_style} onChange={(v) => onUpdateConfig(i, 'voice_style', v)} />
 * ```
 */
export function TtsStyleField({ value, onChange, modified = false }: TtsStyleFieldProps) {
  const emit = (next: string) => onChange(next.trim() ? next : undefined);

  return (
    <div className="card-field">
      <label
        className="text-xs text-foreground/70"
        title="How every line is spoken. Whisper / soft play quieter and shout / angry louder when the scene is orchestrated."
      >
        Style{modified && <ModifiedMark />}:
      </label>
      <input
        type="text"
        value={value ?? ''}
        maxLength={TTS_STYLE.MAX_CHARS}
        onChange={(e) => emit(e.target.value)}
        onFocus={() => pauseStore('soundscape')}
        onBlur={() => setTimeout(() => commitStore('soundscape'), 0)}
        placeholder={TTS_STYLE.PLACEHOLDER}
        className="w-full p-2 text-xs rounded-lg bg-secondary-lighter text-foreground border border-secondary-light focus:border-primary focus:ring-1 focus:ring-primary outline-none"
      />
      <ChipToggleGroup
        options={PRESET_LABELS}
        selected={activeStylePresetLabels(value)}
        onChange={(labels) => emit(applyStylePresetLabels(value, labels))}
        ariaLabel="Speech style helpers"
      />
    </div>
  );
}
