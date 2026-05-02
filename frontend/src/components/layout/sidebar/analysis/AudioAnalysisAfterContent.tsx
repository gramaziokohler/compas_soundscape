'use client';

import { useState } from 'react';
import type { AnalysisResult } from '@/types/analysis';
import { SEDWaveformPlayer } from '@/components/audio/SEDWaveformPlayer';
import { CheckboxField } from '@/components/ui/CheckboxField';
import { API_BASE_URL } from '@/utils/constants';
import { useSoundscapeStore } from '@/store/soundscapeStore';
import { useTextGenerationStore } from '@/store';

interface AudioAnalysisAfterContentProps {
  analysisResult: AnalysisResult;
  audioFile: File;
  audioDuration: number;
  onTogglePromptSelection: (configIndex: number, promptId: string) => void;
}

/**
 * AudioAnalysisAfterContent
 *
 * After-generation UI for audio analysis cards:
 *  1. WaveSurfer player with YAMNet detection region overlays
 *     - Selected sounds show regions; unchecked sounds hide their regions
 *     - Hovering over a sound name isolates its region (others dim)
 *  2. Detected sound list with selection checkboxes
 *  3. Noise reduction checkbox + "Extract & Send" button that:
 *     - Calls /api/extract-sed-segments to slice + calibrate each detection segment
 *     - Injects upload-type sound cards (one per sound, variants = segments) into soundscapeStore
 *     - Switches to Sound Generation tab
 */
export function AudioAnalysisAfterContent({
  analysisResult,
  audioFile,
  audioDuration,
  onTogglePromptSelection,
}: AudioAnalysisAfterContentProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [applyNoiseReduction, setApplyNoiseReduction] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  const injectExtractedSEDSounds = useSoundscapeStore((s) => s.injectExtractedSEDSounds);
  const setActiveAiTab = useTextGenerationStore((s) => s.setActiveAiTab);

  const selectedCount = analysisResult.prompts.filter((p) => p.selected).length;
  const selectedPrompts = analysisResult.prompts.filter((p) => p.selected);

  // Build per-sound data for the waveform player
  const detectedSounds = analysisResult.prompts.map((p) => ({
    name: p.text,
    detection_segments: p.metadata?.detection_segments ?? [],
  }));
  const selectedMask = analysisResult.prompts.map((p) => p.selected);

  const handleExtractAndSend = async () => {
    if (selectedPrompts.length === 0) return;
    setIsExtracting(true);
    setExtractError(null);

    try {
      // Build the segments list for selected sounds only
      const segmentsList = selectedPrompts.map((p) => ({
        name: p.text,
        detection_segments: p.metadata?.detection_segments ?? [],
      })).filter((s) => s.detection_segments.length > 0);

      if (segmentsList.length === 0) {
        setExtractError('No detection segments available for selected sounds.');
        return;
      }

      const formData = new FormData();
      formData.append('file', audioFile);
      formData.append('segments_json', JSON.stringify(segmentsList));
      formData.append('apply_noise_reduction', String(applyNoiseReduction));
      // Use SPL from first selected prompt's metadata, fallback to 70
      const splDb = selectedPrompts[0]?.metadata?.spl_db ?? 70;
      formData.append('target_spl_db', String(splDb));

      const res = await fetch(`${API_BASE_URL}/api/extract-sed-segments`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Extraction failed');
      }

      const data = await res.json();
      const sounds: Array<{
        name: string;
        spl_db?: number;
        interval_seconds?: number;
        variants: Array<{ url: string; duration: number }>;
      }> = data.sounds.map((s: any, si: number) => {
        const matchedPrompt = selectedPrompts[si];
        return {
          name: s.name,
          spl_db: matchedPrompt?.metadata?.spl_db,
          interval_seconds: matchedPrompt?.metadata?.interval_seconds,
          variants: s.variants,
        };
      });

      if (sounds.length === 0) {
        setExtractError('No segments could be extracted. Check that detection segments exist.');
        return;
      }

      injectExtractedSEDSounds(sounds);
      setActiveAiTab('sound');
    } catch (err: any) {
      setExtractError(err.message || 'Extraction failed');
    } finally {
      setIsExtracting(false);
    }
  };

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
        <span className="text-xs font-semibold text-success">
          Detected Sounds
        </span>
        <span className="text-xs text-neutral-300">
          {selectedCount} / {analysisResult.prompts.length} selected
        </span>
      </div>

      {/* Sound list */}
      <div className="max-h-52 overflow-y-auto space-y-1">
        {analysisResult.prompts.map((prompt, i) => (
          <label
            key={prompt.id}
            className="flex items-start gap-0 p-1 rounded cursor-pointer transition-colors"
            style={{
              backgroundColor: prompt.selected ? 'color-mix(in srgb, var(--color-success-hover) 30%, transparent)' : 'transparent',
              borderRadius: '6px',
            }}
            onMouseEnter={(e) => {
              setHoveredIndex(i);
              if (!prompt.selected) e.currentTarget.style.backgroundColor = 'var(--color-secondary-hover)';
            }}
            onMouseLeave={(e) => {
              setHoveredIndex(null);
              if (!prompt.selected) e.currentTarget.style.backgroundColor = 'transparent';
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
                  {prompt.metadata.spl_db !== undefined && (
                    <span>{prompt.metadata.spl_db} dB</span>
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

      {/* Extract & Send controls */}
      <div className="space-y-2 pt-1 border-t border-neutral-700">
        {/* Noise reduction toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <CheckboxField
            checked={applyNoiseReduction}
            onChange={() => setApplyNoiseReduction((v) => !v)}
            label=""
          />
          <span className="text-xs text-neutral-300">
            Apply noise reduction
          </span>
        </label>

        {/* Error */}
        {extractError && (
          <div className="text-xs" style={{ color: 'var(--color-error)' }}>
            {extractError}
          </div>
        )}

        {/* Extract & Send button */}
        <button
          onClick={handleExtractAndSend}
          disabled={isExtracting || selectedCount === 0}
          className="w-full py-1.5 px-3 rounded text-xs font-medium transition-colors"
          style={{
            backgroundColor:
              isExtracting || selectedCount === 0
                ? 'var(--color-secondary)'
                : 'var(--color-success)',
            color: 'white',
            opacity: isExtracting || selectedCount === 0 ? 0.5 : 1,
            cursor: isExtracting || selectedCount === 0 ? 'not-allowed' : 'pointer',
          }}
          title={selectedCount === 0 ? 'Select sounds to extract' : `Extract ${selectedCount} sound(s) and send to generation`}
        >
          {isExtracting
            ? 'Extracting...'
            : `Extract & Send (${selectedCount})`}
        </button>
      </div>
    </div>
  );
}
