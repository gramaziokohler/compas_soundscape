'use client';

import { useState } from 'react';
import type { AnalysisResult } from '@/types/analysis';
import { SEDWaveformPlayer } from '@/components/audio/SEDWaveformPlayer';
import { ToggleField } from '@/components/ui/ToggleField';
import { Notice } from '@/components/ui/Notice';
import { Spinner } from '@/components/ui/Spinner';

interface AudioAnalysisAfterContentProps {
  analysisResult: AnalysisResult;
  /** Source audio File. Null after a refresh when the source file could not be
   *  rehydrated (legacy saves) — the detected-sounds list still renders, only the
   *  waveform/regions are skipped until the user re-uploads the audio. */
  audioFile: File | null;
  audioDuration: number;
  /** True while the saved source audio file is being re-fetched + decoded after a restore. */
  audioReloading?: boolean;
  /** True when a restored source audio file could not be re-downloaded. */
  audioReloadFailed?: boolean;
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
 *  2. Detected sound list with selection toggles
 *  3. Noise reduction toggle
 *
 * Extraction is triggered via the card's floating action button (FAB), not a button here.
 */
export function AudioAnalysisAfterContent({
  analysisResult,
  audioFile,
  audioDuration,
  audioReloading = false,
  audioReloadFailed = false,
  onTogglePromptSelection,
  applyNoiseReduction = false,
  onNoiseReductionChange,
}: AudioAnalysisAfterContentProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const selectedCount = analysisResult.prompts.filter((p) => p.selected).length;
  const allSelected =
    analysisResult.prompts.length > 0 && selectedCount === analysisResult.prompts.length;

  const handleToggleAll = (checked: boolean) => {
    analysisResult.prompts.forEach((prompt) => {
      if (prompt.selected !== checked) {
        onTogglePromptSelection(analysisResult.configIndex, prompt.id);
      }
    });
  };

  // Build per-sound data for the waveform player
  const detectedSounds = analysisResult.prompts.map((p) => ({
    name: p.text,
    detection_segments: p.metadata?.detection_segments ?? [],
  }));
  const selectedMask = analysisResult.prompts.map((p) => p.selected);

  return (
    <div className="card-stack">
      {/* Waveform player with region overlays (only when the source audio is available) */}
      {audioFile ? (
        <SEDWaveformPlayer
          audioFile={audioFile}
          audioDuration={audioDuration}
          detectedSounds={detectedSounds}
          selectedMask={selectedMask}
          hoveredSoundIndex={hoveredIndex}
        />
      ) : audioReloading ? (
        <div
          className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-4 text-xs"
          style={{
            borderColor: 'var(--color-border-strong)',
            color: 'var(--color-secondary-hover)',
          }}
        >
          <Spinner size={14} />
          Restoring saved audio file…
        </div>
      ) : (
        <Notice
          type="warning"
          message={
            audioReloadFailed
              ? 'The saved audio file could not be reloaded — waveform hidden. Re-upload the file to restore it. Detected sounds below are saved.'
              : 'Source audio file unavailable after reload — waveform hidden. Detected sounds below are saved.'
          }
        />
      )}

      {/* Sound list header */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-on-blue">
          Detected Sounds
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs tabular-nums" style={{ color: 'var(--color-on-blue-muted)' }}>
            {selectedCount}/{analysisResult.prompts.length}
          </span>
          <ToggleField
            checked={allSelected}
            onChange={handleToggleAll}
            label="All"
            className="!mb-0"
          />
        </div>
      </div>

      {/* Sound list */}
      <div className="card-stack--tight max-h-[min(208px,45dvh)] overflow-y-auto">
        {analysisResult.prompts.map((prompt, i) => {
          const confidenceSuffix =
            prompt.metadata?.confidence !== undefined
              ? ` (${Math.round(prompt.metadata.confidence * 100)}% conf.)`
              : '';
          const label = `${prompt.text}${confidenceSuffix}`;

          const metadataBits: string[] = [];
          const m = prompt.metadata;
          if (m?.interval_seconds !== undefined) {
            metadataBits.push(`Interval: ${m.interval_seconds}s`);
          }
          if (m?.dbfs !== undefined) {
            metadataBits.push(`${m.dbfs.toFixed(2)} dBFS`);
          }
          if (m?.detection_segments && m.detection_segments.length > 0) {
            metadataBits.push(`${m.detection_segments.length} seg.`);
          }

          const isHovered = hoveredIndex === i;
          const rowBackground = isHovered
            ? 'color-mix(in srgb, var(--color-warning) 28%, transparent)'
            : prompt.selected
              ? 'var(--color-on-blue-faint)'
              : 'transparent';

          return (
            <div
              key={prompt.id}
              className="p-1 rounded transition-colors"
              style={{
                backgroundColor: rowBackground,
                borderRadius: '6px',
              }}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <ToggleField
                checked={prompt.selected}
                onChange={() => onTogglePromptSelection(analysisResult.configIndex, prompt.id)}
                label={label}
                className="!mb-0"
              />
              {metadataBits.length > 0 && (
                <div className="card-title-info text-[10px]" style={{ color: 'var(--color-on-blue-muted)' }}>
                  {metadataBits.join(', ')}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Noise reduction toggle (extraction triggered by card FAB) */}
      <div style={{ borderTop: '1px solid var(--color-on-blue-faint)', paddingTop: 'var(--card-gap-row)' }}>
        <ToggleField
          checked={applyNoiseReduction}
          onChange={(checked) => onNoiseReductionChange?.(checked)}
          label="Apply noise reduction on extraction"
          className="!mb-0"
        />
      </div>
    </div>
  );
}
