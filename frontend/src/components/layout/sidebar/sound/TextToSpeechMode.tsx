'use client';

import type { SoundGenerationConfig } from '@/types';
import { pauseStore, commitStore, globalUndo, globalRedo } from '@/store';
import { TTS_VOICES, TTS_DEFAULT_VOICE } from '@/utils/constants';
import { useTtsSpeechLines } from '@/hooks/useTtsSpeechLines';

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
        <select
          value={config.voice_name || TTS_DEFAULT_VOICE}
          onChange={(e) => onUpdateConfig(index, 'voice_name', e.target.value)}
          onFocus={() => pauseStore('soundscape')}
          onBlur={() => setTimeout(() => commitStore('soundscape'), 0)}
          className="w-full p-1.5 text-xs rounded-lg bg-secondary-lighter text-foreground border border-secondary-light focus:border-primary focus:ring-1 focus:ring-primary outline-none"
        >
          {TTS_VOICES.map((voice) => (
            <option key={voice.value} value={voice.value}>
              {voice.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
