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
        <span className="text-xs font-semibold text-on-blue">
          Detected Sounds
        </span>
        <span className="text-xs" style={{ color: 'var(--color-on-blue-muted)' }}>
          {selectedCount} / {analysisResult.prompts.length} selected
        </span>
      </div>

      {/* Sound list */}
      <div className="max-h-[min(208px,45dvh)] overflow-y-auto space-y-1">
        {analysisResult.prompts.map((prompt, i) => (
          <div
            key={prompt.id}
            className="flex items-start gap-0 p-1 rounded cursor-pointer transition-colors"
            style={{
              backgroundColor: prompt.selected ? 'var(--color-on-blue-faint)' : 'transparent',
              borderRadius: '6px',
              cursor: 'pointer',
            }}
            onClick={() => onTogglePromptSelection(analysisResult.configIndex, prompt.id)}
            onMouseEnter={(e) => {
              setHoveredIndex(i);
              e.currentTarget.style.backgroundColor = 'var(--color-on-blue-faint)';
            }}
            onMouseLeave={(e) => {
              setHoveredIndex(null);
               e.currentTarget.style.backgroundColor = prompt.selected? 'var(--color-on-blue-faint)' : 'transparent';
            }}
          >
            <CheckboxField
              checked={prompt.selected}
              onChange={() => onTogglePromptSelection(analysisResult.configIndex, prompt.id)}
              label=""
            />
            <div className="flex-1 text-xs" style={{ color: 'var(--color-on-blue)' }}>
              {prompt.text}
              {prompt.metadata?.confidence !== undefined && (
                <span className="ml-1">
                  ({Math.round(prompt.metadata.confidence * 100)}% conf.)
                </span>
              )}
              {(() => {
                const m = prompt.metadata;
                const bits: string[] = [];
                if (m?.interval_seconds !== undefined) {
                  bits.push(`Interval: ${m.interval_seconds}s`);
                }
                if (m?.dbfs !== undefined) {
                  bits.push(`${m.dbfs.toFixed(2)} dBFS`);
                }
                if (m?.detection_segments && m.detection_segments.length > 0) {
                  bits.push(`${m.detection_segments.length} seg.`);
                }
                if (bits.length === 0) return null;
                return (
                  <div className="mt-0.5 text-[10px]" style={{ color: 'var(--color-on-blue-muted)' }}>
                    {bits.join(', ')}
                  </div>
                );
              })()}
            </div>
          </div>
        ))}
      </div>

      {/* Noise reduction toggle (extraction triggered by card FAB) */}
      <div className="pt-1" style={{ borderTop: '1px solid var(--color-on-blue-faint)' }}>
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => onNoiseReductionChange?.(!applyNoiseReduction)}
        >
          <CheckboxField
            checked={applyNoiseReduction}
            onChange={() => onNoiseReductionChange?.(!applyNoiseReduction)}
            label=""
          />
          <span className="text-xs" style={{ color: 'var(--color-on-blue)' }}>
            Apply noise reduction on extraction
          </span>
        </div>
      </div>
    </div>
  );
}
