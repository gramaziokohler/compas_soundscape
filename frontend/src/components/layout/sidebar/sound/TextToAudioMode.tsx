'use client';

import { useState } from 'react';
import type { SoundGenerationConfig } from '@/types';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { pauseStore, commitStore, globalUndo, globalRedo } from '@/store';
import { useBatchedSlider } from '@/hooks/useBatchedSlider';
import { useSoundscapeStore } from '@/store';
import { DEFAULT_DURATION_SECONDS, DEFAULT_GUIDANCE_SCALE, DEFAULT_SEED_COPIES } from '@/utils/constants';

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
  /** When true, only renders the textarea (sliders are omitted — rendered separately as collapsible). */
  hideSliders?: boolean;
}

/** Standalone sliders panel — duration, guidance, variants. Used in the collapsible section. */
export function TextToAudioSliders({
  config,
  index,
  onUpdateConfig,
}: Omit<TextToAudioModeProps, 'hideSliders'>) {
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
      <div className="grid gap-1">
        <RangeSlider
          label="Duration"
          value={config.duration}
          min={1}
          max={30}
          step={1}
          unit="s"
          defaultValue={DEFAULT_DURATION_SECONDS}
          onDragStart={durationSlider.onDragStart}
          onChange={durationSlider.onChange}
          onChangeCommitted={durationSlider.onCommit}
          showLabels={false}
        />

        <RangeSlider
          label="Guidance"
          value={config.guidance_scale ?? DEFAULT_GUIDANCE_SCALE}
          min={0}
          max={10}
          step={0.5}
          defaultValue={DEFAULT_GUIDANCE_SCALE}
          onDragStart={guidanceSlider.onDragStart}
          onChange={guidanceSlider.onChange}
          onChangeCommitted={guidanceSlider.onCommit}
          showLabels={false}
          hoverText="Low guidance = AI model can get creative, but follows less your prompts"
        />
      <RangeSlider
        label="Variants"
        value={config.seed_copies}
        min={1}
        max={5}
        step={1}
        defaultValue={DEFAULT_SEED_COPIES}
        onDragStart={variantsSlider.onDragStart}
        onChange={variantsSlider.onChange}
        onChangeCommitted={variantsSlider.onCommit}
        showLabels={false}
        hoverText="This will generate multiple variants of sounds from your prompt"
      />
    </div>
    </>
  );
}

/** Collapsible "Additional settings" panel wrapping the generation sliders. */
export function AdditionalSettings({
  config,
  index,
  onUpdateConfig,
}: Omit<TextToAudioModeProps, 'hideSliders'>) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="mt-0">
      <button
        onClick={() => setIsExpanded((v) => !v)}
        className="flex items-center gap-1.5 w-full text-left text-xs text-secondary-hover hover:text-foreground transition-colors"
      >
        {isExpanded ? <ChevronDown size={11} className="shrink-0" /> : <ChevronRight size={11} className="shrink-0" />}
        <span>Additional settings</span>
      </button>
      {isExpanded && (
        <div className="mt-2">
          <TextToAudioSliders config={config} index={index} onUpdateConfig={onUpdateConfig} />
        </div>
      )}
    </div>
  );
}

export function TextToAudioMode({ config, index, onUpdateConfig, hideSliders }: TextToAudioModeProps) {
  const applyNoiseReduction = useSoundscapeStore((s) => s.applyNoiseReduction);

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
        className="w-full h-16 p-2 text-xs rounded-lg bg-secondary-lighter text-foreground border border-secondary-light focus:border-primary focus:ring-1 focus:ring-primary outline-none"
        rows={2}
      />

      {hideSliders ? (
        <AdditionalSettings config={config} index={index} onUpdateConfig={onUpdateConfig} />
      ) : (
        <TextToAudioSliders config={config} index={index} onUpdateConfig={onUpdateConfig} />
      )}
    </>
  );
}

