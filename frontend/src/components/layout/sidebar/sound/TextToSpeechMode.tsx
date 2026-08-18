'use client';

import type { SoundGenerationConfig } from '@/types';
import { pauseStore, commitStore, globalUndo, globalRedo } from '@/store';
import { TTS_VOICES, TTS_DEFAULT_VOICE } from '@/utils/constants';
import { useTtsSpeechLines } from '@/hooks/useTtsSpeechLines';
import { CardSelect } from '@/components/ui/CardSelect';

export interface TextToSpeechModeProps {
  config: SoundGenerationConfig;
  index: number;
  onUpdateConfig: (index: number, field: keyof SoundGenerationConfig, value: any) => void;
}

export function TextToSpeechMode({ config, index, onUpdateConfig }: TextToSpeechModeProps) {
  const { onPromptChange } = useTtsSpeechLines(config, index, onUpdateConfig);

  return (
    <div className="space-y-2">

      <textarea
        value={config.prompt}
        onChange={(e) => onPromptChange(e.target.value)}
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
        placeholder="Enter text to speak..."
        className="w-full h-20 p-2 text-xs rounded-lg bg-secondary-lighter text-foreground border border-secondary-light focus:border-primary focus:ring-1 focus:ring-primary outline-none resize-none"
        rows={3}
      />

      <div className="flex items-center gap-2">
        <label className="text-xs text-foreground/70 whitespace-nowrap">Voice:</label>
        <CardSelect
          value={config.voice_name || TTS_DEFAULT_VOICE}
          onChange={(v) => onUpdateConfig(index, 'voice_name', v)}
          compact
          className="flex-1"
          options={TTS_VOICES.map((voice) => ({
            value: voice.value,
            label: voice.label,
          }))}
        />
      </div>
    </div>
  );
}
