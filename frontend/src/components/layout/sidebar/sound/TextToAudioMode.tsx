'use client';

import { useState } from 'react';
import type { SoundGenerationConfig } from '@/types';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { ToggleField } from '@/components/ui/ToggleField';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { pauseStore, commitStore, globalUndo, globalRedo } from '@/store';
import { useBatchedSlider } from '@/hooks/useBatchedSlider';
import { useSoundscapeStore } from '@/store';
import {
  AUDIO_MODEL_ELEVENLABS,
  DEFAULT_DURATION_SECONDS,
  DEFAULT_GUIDANCE_SCALE,
  DEFAULT_PROMPT_INFLUENCE,
  DEFAULT_SEED_COPIES,
  PROMPT_INFLUENCE_MAX,
  PROMPT_INFLUENCE_MIN,
  PROMPT_INFLUENCE_STEP,
  normalizeSoundCategory,
} from '@/utils/constants';

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

/**
 * Standalone sliders panel — used in the collapsible section.
 *
 * TangoFlux: Duration / Guidance / Variants.
 * ElevenLabs: Prompt influence / Loopable / Variants (duration is auto-detected
 * by the model, so the Duration slider is omitted for ElevenLabs).
 */
export function TextToAudioSliders({
  config,
  index,
  onUpdateConfig,
}: Omit<TextToAudioModeProps, 'hideSliders'>) {
  const audioModel = useSoundscapeStore((s) => s.audioModel);
  const isElevenLabs = audioModel === AUDIO_MODEL_ELEVENLABS;
  const isBackground = normalizeSoundCategory(config.category) === 'background';

  const durationSlider = useBatchedSlider<number>('soundscape', (v) =>
    onUpdateConfig(index, 'duration', v),
  );
  const guidanceSlider = useBatchedSlider<number>('soundscape', (v) =>
    onUpdateConfig(index, 'guidance_scale', v),
  );
  const promptInfluenceSlider = useBatchedSlider<number>('soundscape', (v) =>
    onUpdateConfig(index, 'prompt_influence', v),
  );
  const variantsSlider = useBatchedSlider<number>('soundscape', (v) =>
    onUpdateConfig(index, 'seed_copies', v),
  );

  return (
    <>
      <div className="card-stack--tight">
        {isElevenLabs ? (
          <RangeSlider
            label="Prompt influence"
            value={config.prompt_influence ?? DEFAULT_PROMPT_INFLUENCE}
            min={PROMPT_INFLUENCE_MIN}
            max={PROMPT_INFLUENCE_MAX}
            step={PROMPT_INFLUENCE_STEP}
            defaultValue={DEFAULT_PROMPT_INFLUENCE}
            onDragStart={promptInfluenceSlider.onDragStart}
            onChange={promptInfluenceSlider.onChange}
            onChangeCommitted={promptInfluenceSlider.onCommit}
            showLabels={false}
            hoverText="Higher = follows your prompt more literally; lower = more creative variation. Duration is auto-detected by ElevenLabs."
          />
        ) : (
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
        )}

        {!isElevenLabs && (
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
        )}

        {isElevenLabs && (
          <ToggleField
            checked={config.loop ?? isBackground}
            onChange={(v) => onUpdateConfig(index, 'loop', v)}
            label="Loopable"
            badge={isBackground ? 'Background' : undefined}
          />
        )}

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
        <div className="card-collapse-body">
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

