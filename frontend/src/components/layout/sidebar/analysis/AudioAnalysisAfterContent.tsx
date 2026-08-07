'use client';

import { useState } from 'react';
import type { AnalysisResult } from '@/types/analysis';
import { SEDWaveformPlayer } from '@/components/audio/SEDWaveformPlayer';
import { CheckboxField } from '@/components/ui/CheckboxField';
import { API_BASE_URL } from '@/utils/constants';

interface AudioAnalysisAfterContentProps {
  analysisResult: AnalysisResult;
  audioFile: File;
  audioDuration: number;
  onTogglePromptSelection: (configIndex: number, promptId: string) => void;
  /** Controlled noise-reduction toggle (lifted to config via onUpdateConfig) */
  applyNoiseReduction?: boolean;
  onNoiseReductionChange?: (val: boolean) => void;
}

/**
 * AudioAnalysisAfterContent
 *
 * After-generation UI for audio analysis cards:
 *  1. WaveSurfer player with YAMNet detection region overlays
 *  2. Detected sound list with selection checkboxes
 *  3. Noise reduction toggle
 *
 * Extraction is triggered via the card's floating action button (FAB), not a button here.
 */
export function AudioAnalysisAfterContent({
  analysisResult,
  audioFile,
  audioDuration,
  onTogglePromptSelection,
  applyNoiseReduction = false,
  onNoiseReductionChange,
}: AudioAnalysisAfterContentProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const selectedCount = analysisResult.prompts.filter((p) => p.selected).length;

  // Build per-sound data for the waveform player
  const detectedSounds = analysisResult.prompts.map((p) => ({
    name: p.text,
    detection_segments: p.metadata?.detection_segments ?? [],
  }));
  const selectedMask = analysisResult.prompts.map((p) => p.selected);

  return (
    <div className="space-y-3">
      {/* Waveform player with region overlays */}
      <SEDWaveformPlayer
        audioFile={audioFile}
        audioDuration={audioDuration}
        detectedSounds={detectedSounds}
        selectedMask={selectedMask}
        hoveredSoundIndex={hoveredIndex}
      />

      {/* Sound list header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-secondary">
          Detected Sounds
        </span>
        <span className="text-xs text-secondary-hover">
          {selectedCount} / {analysisResult.prompts.length} selected
        </span>
      </div>

      {/* Sound list */}
      <div className="max-h-[min(208px,45dvh)] overflow-y-auto space-y-1">
        {analysisResult.prompts.map((prompt, i) => (
          <label
            key={prompt.id}
            className="flex items-start gap-0 p-1 rounded cursor-pointer transition-colors"
            style={{
              backgroundColor: prompt.selected ? 'color-mix(in srgb, var(--color-secondary) 30%, transparent)' : 'transparent',
              borderRadius: '6px',
            }}
            onMouseEnter={(e) => {
              setHoveredIndex(i);
              e.currentTarget.style.backgroundColor = 'var(--color-primary)';
            }}
            onMouseLeave={(e) => {
              setHoveredIndex(null);
               e.currentTarget.style.backgroundColor = prompt.selected? 'color-mix(in srgb, var(--color-secondary) 30%, transparent)' : 'transparent';
            }}
          >
            <CheckboxField
              checked={prompt.selected}
              onChange={() => onTogglePromptSelection(analysisResult.configIndex, prompt.id)}
              label=""
            />
            <div className="flex-1 text-xs text-neutral-200">
              {prompt.text}
              {prompt.metadata && (
                <div className="flex gap-3 mt-0.5 text-[10px] text-neutral-400">
                  {prompt.metadata.confidence !== undefined && (
                    <span>{(prompt.metadata.confidence * 100).toFixed(0)}% conf.</span>
                  )}
                  {prompt.metadata.dbfs !== undefined && (
                    <span>{prompt.metadata.dbfs} dBFS</span>
                  )}
                  {prompt.metadata.interval_seconds !== undefined && (
                    <span>{prompt.metadata.interval_seconds}s int.</span>
                  )}
                  {prompt.metadata.detection_segments && prompt.metadata.detection_segments.length > 0 && (
                    <span>{prompt.metadata.detection_segments.length} seg.</span>
                  )}
                </div>
              )}
            </div>
          </label>
        ))}
      </div>

      {/* Noise reduction toggle (extraction triggered by card FAB) */}
      <div className="pt-1 border-t border-neutral-700">
        <label className="flex items-center gap-2 cursor-pointer">
          <CheckboxField
            checked={applyNoiseReduction}
            onChange={() => onNoiseReductionChange?.(!applyNoiseReduction)}
            label=""
          />
          <span className="text-xs text-neutral-300">
            Apply noise reduction on extraction
          </span>
        </label>
      </div>
    </div>
  );
}
