'use client';

import type { SoundGenerationConfig } from '@/types';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { pauseStore, commitStore, globalUndo, globalRedo } from '@/store';
import { useBatchedSlider } from '@/hooks/useBatchedSlider';

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
  // Batched sliders — one undo step per drag gesture
  const durationSlider = useBatchedSlider<number>('soundscape', (v) =>
    onUpdateConfig(index, 'duration', v),
  );
  const guidanceSlider = useBatchedSlider<number>('soundscape', (v) =>
    onUpdateConfig(index, 'guidance_scale', v),
  );
  const variantsSlider = useBatchedSlider<number>('soundscape', (v) =>
    onUpdateConfig(index, 'seed_copies', v),
  );

  return (
    <>
      <textarea
        value={config.prompt}
        onChange={(e) => onUpdateConfig(index, 'prompt', e.target.value)}
        onFocus={() => pauseStore('soundscape')}
        onBlur={() => setTimeout(() => commitStore('soundscape'), 0)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
            e.preventDefault();
            commitStore('soundscape');
            globalUndo();
            pauseStore('soundscape');
          }
          if ((e.ctrlKey || e.metaKey) && (e.shiftKey ? e.key === 'z' : e.key === 'y')) {
            e.preventDefault();
            commitStore('soundscape');
            globalRedo();
            pauseStore('soundscape');
          }
        }}
        placeholder="e.g., Hammer hitting wooden table"
        className="w-full h-16 p-2 text-xs rounded-lg bg-white border border-secondary-light focus:border-primary focus:ring-1 focus:ring-primary outline-none"
        rows={2}
      />

      <div className="grid grid-cols-2 gap-2">
        <RangeSlider
          label="Duration (s): "
          value={config.duration}
          min={1}
          max={30}
          step={1}
          onDragStart={durationSlider.onDragStart}
          onChange={durationSlider.onChange}
          onChangeCommitted={durationSlider.onCommit}
          showLabels={false}
        />

        <RangeSlider
          label="Guidance: "
          value={config.guidance_scale ?? 4.5}
          min={0}
          max={10}
          step={0.5}
          onDragStart={guidanceSlider.onDragStart}
          onChange={guidanceSlider.onChange}
          onChangeCommitted={guidanceSlider.onCommit}
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
        onDragStart={variantsSlider.onDragStart}
        onChange={variantsSlider.onChange}
        onChangeCommitted={variantsSlider.onCommit}
        showLabels={false}
        hoverText="This will generate multiple variants of sounds from your prompt"
      />
    </>
  );
}
