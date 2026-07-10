'use client';

import type { SoundGenerationConfig } from '@/types';
import { pauseStore, commitStore, globalUndo, globalRedo } from '@/store';
import { TTS_VOICES, TTS_DEFAULT_VOICE } from '@/utils/constants';

export interface TextToSpeechModeProps {
  config: SoundGenerationConfig;
  index: number;
  onUpdateConfig: (index: number, field: keyof SoundGenerationConfig, value: any) => void;
}

export function TextToSpeechMode({ config, index, onUpdateConfig }: TextToSpeechModeProps) {
  const speechLines = config.orchestrateMeta?.speechLines;

  const selectedSpeechLineIdx = speechLines ? speechLines.indexOf(config.prompt) : -1;

  const handleAddSpeechLine = () => {
    const currentLines = speechLines ?? [];
    const newLines = [...currentLines, ''];
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
    onUpdateConfig(index, 'prompt', '');
  };

  const handleDeleteSpeechLine = (lineIdx: number) => {
    const currentLines = speechLines ?? [];
    if (currentLines.length <= 1) return;
    const newLines = currentLines.filter((_, i) => i !== lineIdx);
    onUpdateConfig(index, 'orchestrateMeta', {
      ...config.orchestrateMeta!,
      speechLines: newLines,
    });
    if (lineIdx === selectedSpeechLineIdx) {
      onUpdateConfig(index, 'prompt', newLines[0] ?? '');
    }
  };

  const handlePromptChange = (value: string) => {
    onUpdateConfig(index, 'prompt', value);
    if (speechLines && selectedSpeechLineIdx >= 0 && selectedSpeechLineIdx < speechLines.length) {
      const newLines = [...speechLines];
      newLines[selectedSpeechLineIdx] = value;
      onUpdateConfig(index, 'orchestrateMeta', {
        ...config.orchestrateMeta!,
        speechLines: newLines,
      });
    }
  };

  return (
    <div className="space-y-2">

      <textarea
        value={config.prompt}
        onChange={(e) => handlePromptChange(e.target.value)}
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

      {speechLines && speechLines.length > 0 && (
        <div
          className="flex gap-1 overflow-x-auto flex-shrink-0 items-center"
          style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--card-color, var(--color-primary)) transparent' }}
        >
          {speechLines.map((line, idx) => (
            <button
              key={idx}
              onClick={() => onUpdateConfig(index, 'prompt', line)}
              title={line}
              className={`w-5 h-5 text-[10px] rounded transition-colors flex-shrink-0 relative group ${
                idx === selectedSpeechLineIdx ? 'text-white' : 'bg-secondary text-secondary-light'
              }`}
              style={idx === selectedSpeechLineIdx ? { backgroundColor: 'var(--card-color, var(--color-primary))' } : undefined}
            >
              {String.fromCharCode(65 + idx)}
              {speechLines.length > 1 && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteSpeechLine(idx);
                  }}
                  className="absolute -top-1 -right-1 w-3 h-3 text-[8px] rounded-full bg-red-500 text-white hidden group-hover:flex items-center justify-center leading-none"
                >
                  ×
                </span>
              )}
            </button>
          ))}
          <button
            onClick={handleAddSpeechLine}
            title="Add speech line"
            className="w-5 h-5 text-[10px] rounded border border-dashed border-secondary-light text-secondary-hover hover:text-foreground hover:border-foreground transition-colors flex-shrink-0 flex items-center justify-center"
          >
            +
          </button>
        </div>
      )}


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
