'use client';

import type { SoundGenerationConfig } from '@/types';
import { RangeSlider } from '@/components/ui/RangeSlider';

/**
 * TextToAudioMode Component
 *
 * Configuration UI for text-to-audio sound generation mode.
 * Allows users to enter a prompt and configure generation parameters.
 */

export interface TextToAudioModeProps {
  config: SoundGenerationConfig;
  index: number;
  onUpdateConfig: (index: number, field: keyof SoundGenerationConfig, value: any) => void;
}

export function TextToAudioMode({ config, index, onUpdateConfig }: TextToAudioModeProps) {
  return (
    <>
      <textarea
        value={config.prompt}
        onChange={(e) => onUpdateConfig(index, 'prompt', e.target.value)}
        placeholder="e.g., Hammer hitting wooden table"
        className="w-full h-16 p-2 text-sm rounded-lg bg-white border border-secondary-light focus:border-primary focus:ring-1 focus:ring-primary outline-none"
        rows={2}
      />

      <div className="grid grid-cols-2 gap-2">
        <RangeSlider
          label="Duration (s): "
          value={config.duration}
          min={1}
          max={30}
          step={1}
          onChange={(value) => onUpdateConfig(index, 'duration', value)}
          showLabels={false}
        />

        <RangeSlider
          label="Guidance: "
          value={config.guidance_scale ?? 4.5}
          min={0}
          max={10}
          step={0.5}
          onChange={(value) => onUpdateConfig(index, 'guidance_scale', value)}
          showLabels={false}
          hoverText="Low guidance = AI model can get creative, but follows less your prompts"
        />
      </div>

      <RangeSlider
        label="Number of variants: "
        value={config.seed_copies}
        min={1}
        max={5}
        step={1}
        onChange={(value) => onUpdateConfig(index, 'seed_copies', value)}
        showLabels={false}
        hoverText="This will generate multiple variants of sounds from your prompt"
      />
    </>
  );
}
