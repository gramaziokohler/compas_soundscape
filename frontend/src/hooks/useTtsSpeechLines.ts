import { useCallback, useMemo } from 'react';
import type { SoundGenerationConfig } from '@/types';

type UpdateConfig = (index: number, field: keyof SoundGenerationConfig, value: any) => void;

export interface TtsSpeechLinesHandlers {
  /** All speech lines from config.orchestrateMeta.speechLines ([] when absent). */
  speechLines: string[];
  /** Index of the active line (config.prompt) within speechLines, if present. */
  selectedIndex?: number;
  /** Set the active prompt to the given speech line. */
  onSelectLine: (lineIdx: number) => void;
  /** Remove a speech line (refuses to go below one line); resets prompt if it was active. */
  onDeleteLine: (lineIdx: number) => void;
  /** Append a new empty speech line and make it active. */
  onAddLine: () => void;
  /** Update the prompt and, when a speech line is active, sync the text back into it. */
  onPromptChange: (value: string) => void;
}

/**
 * Pure speech-line state mutations for TTS configs. Speech lines live in
 * `config.orchestrateMeta.speechLines`; the active line is `config.prompt`.
 *
 * This is a plain function (not a hook) so it can be called from both
 * components (via `useTtsSpeechLines`) and non-component contexts such as
 * `SoundGenerationSection.renderCard`, which builds the Card-level VariantsBar.
 *
 * Scenario-output TTS cards arrive with `speechLines` pre-populated (first line
 * = active prompt) — these mutations behave identically to the previous inline
 * implementation, preserving the old workflow.
 */
export function createTtsSpeechLines(
  config: SoundGenerationConfig,
  index: number,
  onUpdateConfig: UpdateConfig,
): TtsSpeechLinesHandlers {
  const speechLines = config.orchestrateMeta?.speechLines ?? [];
  const promptIdx = speechLines.indexOf(config.prompt);
  const selectedIndex = promptIdx >= 0 ? promptIdx : undefined;

  const updateSpeechLines = (newLines: string[], nextPrompt?: string) => {
    onUpdateConfig(index, 'orchestrateMeta', {
      orchestrateId: config.orchestrateMeta?.orchestrateId ?? '',
      entryId: config.orchestrateMeta?.entryId ?? '',
      trigger: config.orchestrateMeta?.trigger ?? { type: '', expression: [], delay: [] },
      variants: config.orchestrateMeta?.variants ?? [],
      allObjectIds: config.orchestrateMeta?.allObjectIds ?? [],
      speechLines: newLines,
      isSpeech: config.orchestrateMeta?.isSpeech ?? true,
      voiceName: config.orchestrateMeta?.voiceName ?? config.voice_name,
      timestamps: config.orchestrateMeta?.timestamps ?? [],
    });
    if (nextPrompt !== undefined) {
      onUpdateConfig(index, 'prompt', nextPrompt);
    }
  };

  const onSelectLine = (lineIdx: number) => {
    const line = speechLines[lineIdx];
    if (line !== undefined) {
      onUpdateConfig(index, 'prompt', line);
    }
  };

  const onDeleteLine = (lineIdx: number) => {
    if (speechLines.length <= 1 || lineIdx < 0 || lineIdx >= speechLines.length) return;
    const newLines = speechLines.filter((_, i) => i !== lineIdx);
    const wasActive = lineIdx === selectedIndex;
    updateSpeechLines(newLines, wasActive ? (newLines[0] ?? '') : undefined);
  };

  const onAddLine = () => {
    // Keep the current line intact. When no speech lines exist yet but a prompt
    // has been typed, seed it as the first line (variant A) so it isn't wiped.
    const baseLines = speechLines.length === 0 && config.prompt.trim() !== ''
      ? [config.prompt]
      : speechLines;
    // Append a new empty line and activate it (the new "window" to type into).
    updateSpeechLines([...baseLines, ''], '');
  };

  const onPromptChange = (value: string) => {
    onUpdateConfig(index, 'prompt', value);
    if (selectedIndex !== undefined && selectedIndex >= 0 && selectedIndex < speechLines.length) {
      const newLines = [...speechLines];
      newLines[selectedIndex] = value;
      updateSpeechLines(newLines);
    }
  };

  return { speechLines, selectedIndex, onSelectLine, onDeleteLine, onAddLine, onPromptChange };
}

/**
 * useTtsSpeechLines
 *
 * Hook wrapper around `createTtsSpeechLines` for use inside components
 * (e.g. TextToSpeechMode's textarea + voice select).
 */
export function useTtsSpeechLines(
  config: SoundGenerationConfig,
  index: number,
  onUpdateConfig: UpdateConfig,
): TtsSpeechLinesHandlers {
  const update = useCallback(
    (i: number, field: keyof SoundGenerationConfig, value: any) => onUpdateConfig(i, field, value),
    [onUpdateConfig],
  );
  return useMemo(
    () => createTtsSpeechLines(config, index, update),
    [config, index, update],
  );
}
