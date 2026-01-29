'use client';

import { useState, useEffect } from 'react';
import type { SoundGenerationConfig, SoundEvent, LibrarySearchResult, SoundState } from '@/types';
import { FileUploadArea } from '@/components/controls/FileUploadArea';
import { AudioWaveformDisplay } from '@/components/audio/AudioWaveformDisplay';
import { VerticalVolumeSlider } from '@/components/ui/VerticalVolumeSlider';
import { SoundCardWaveSurfer } from '@/components/audio/SoundCardWaveSurfer';
import { UI_COLORS, UI_VOLUME_SLIDER, UI_INTERVAL_SLIDER } from '@/lib/constants';
import { RangeSlider } from '@/components/ui/RangeSlider';

/**
 * SoundTab Component
 * 
 * Displays a single sound generation configuration in the sidebar.
 * 
 * **States:**
 * - Collapsed: Shows only title and action buttons (close, reset, link)
 * - Expanded (not generated): Shows full generation UI with all controls
 * - Expanded (generated): Shows sound playback controls (volume, interval, mute, solo)
 * 
 * **Background Colors:**
 * - Not generated: Lighter neutral background
 * - Generated: Success-tinted background
 */

interface SoundTabProps {
  config: SoundGenerationConfig;
  index: number;
  isExpanded: boolean;
  isGenerated: boolean;
  generatedSound?: SoundEvent;
  soundState?: SoundState;
  isSoundGenerating?: boolean;
  modelEntities?: any[];
  isLinkingEntity?: boolean;
  linkingConfigIndex?: number | null;
  useSpeckleViewer?: boolean; // Whether Speckle viewer is active (enables entity linking)
  isMuted?: boolean;
  isSoloed?: boolean;
  variants?: SoundEvent[]; // All variants for this prompt
  selectedVariantIdx?: number; // Currently selected variant index

  // Callbacks
  onToggleExpand: (index: number) => void;
  onUpdateConfig: (index: number, field: keyof SoundGenerationConfig, value: any) => void;
  onRemove: (index: number) => void;
  onReset: (index: number) => void;
  onStartLinkingEntity?: (index: number) => void;
  onCancelLinkingEntity?: () => void;
  onUploadAudio?: (index: number, file: File) => Promise<void>;
  onClearUploadedAudio?: (index: number) => void;
  onLibrarySearch?: (index: number) => Promise<void>;
  onLibrarySoundSelect?: (index: number, sound: LibrarySearchResult) => void;
  onToggleSound?: (soundId: string) => void;
  onVolumeChange?: (soundId: string, volumeDb: number) => void;
  onIntervalChange?: (soundId: string, intervalSeconds: number) => void;
  onMute?: (soundId: string) => void;
  onSolo?: (soundId: string) => void;
  onVariantChange?: (promptIdx: number, variantIdx: number) => void;
  onSelectCard?: () => void;
  soundVolumes?: { [soundId: string]: number };
  soundIntervals?: { [soundId: string]: number };
  // Soundcard preview playback
  isPreviewPlaying?: boolean;
  onPreviewPlayPause?: (soundId: string) => void;
  onPreviewStop?: (soundId: string) => void;
}

export function SoundTab({
  config,
  index,
  isExpanded,
  isGenerated,
  generatedSound,
  soundState,
  isSoundGenerating,
  modelEntities = [],
  isLinkingEntity = false,
  linkingConfigIndex = null,
  useSpeckleViewer = false,
  isMuted = false,
  isSoloed = false,
  variants = [],
  selectedVariantIdx = 0,
  onToggleExpand,
  onUpdateConfig,
  onRemove,
  onReset,
  onStartLinkingEntity,
  onCancelLinkingEntity,
  onUploadAudio,
  onClearUploadedAudio,
  onLibrarySearch,
  onLibrarySoundSelect,
  onToggleSound,
  onVolumeChange,
  onIntervalChange,
  onMute,
  onSolo,
  onVariantChange,
  onSelectCard,
  soundVolumes = {},
  soundIntervals = {},
  isPreviewPlaying = false,
  onPreviewPlayPause,
  onPreviewStop
}: SoundTabProps) {
  // File upload state
  const [isDragging, setIsDragging] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Name editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingValue, setEditingValue] = useState('');

  // Display name (prioritize config display_name, then generatedSound display_name, then fallback)
  const baseName = config.display_name || generatedSound?.display_name;
  const displayName = baseName ? `${index + 1}. ${baseName}` : `Sound ${index + 1}`;

  // Current mode and state
  const currentMode = config.mode || 'text-to-audio';
  const hasUploadedAudio = config.uploadedAudioInfo !== undefined;

  // Name editing handlers
  const handleDoubleClickName = () => {
    setIsEditingName(true);
    setEditingValue(baseName || '');
  };

  const handleSaveName = () => {
    if (editingValue.trim()) {
      onUpdateConfig(index, 'display_name', editingValue.trim());
    }
    setIsEditingName(false);
  };

  const handleCancelEdit = () => {
    setIsEditingName(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveName();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  // Background color based on generation state
  const backgroundColor = isGenerated ? UI_COLORS.DARK_BG : UI_COLORS.NEUTRAL_100;
  const textColor = isGenerated ? UI_COLORS.NEUTRAL_200 : UI_COLORS.NEUTRAL_900;

  // Visual feedback for mute/solo state (grey out muted cards)
  const cardOpacity = isMuted ? 0.5 : 1.0;

  // Volume and interval for generated sounds - read from live state
  const currentVolumeDb = generatedSound ? (soundVolumes[generatedSound.id] ?? generatedSound.volume_db ?? 70) : 70;
  const currentIntervalSeconds = generatedSound ? (soundIntervals[generatedSound.id] ?? generatedSound.interval_seconds ?? 30) : 30;

  // Local state for interval slider (visual feedback while dragging)
  const [tempIntervalSeconds, setTempIntervalSeconds] = useState(currentIntervalSeconds);

  // Sync temp interval with actual interval when it changes externally
  // Using useEffect to avoid setState during render
  useEffect(() => {
    setTempIntervalSeconds(currentIntervalSeconds);
  }, [currentIntervalSeconds]);

  // Drag and drop handlers for file upload
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0 || !onUploadAudio) return;

    const file = files[0];
    setUploadFile(file);
    await onUploadAudio(index, file);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !onUploadAudio) return;

    const file = files[0];
    setUploadFile(file);
    await onUploadAudio(index, file);
    
    // Reset input
    e.target.value = "";
  };

  const handleClearAudio = () => {
    setUploadFile(null);
    onClearUploadedAudio?.(index);
  };

  return (
    <div
      className="rounded transition-all"
      style={{
        backgroundColor,
        padding: isExpanded ? '12px' : '8px',
        borderRadius: '8px',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: isExpanded ? UI_COLORS.NEUTRAL_300 : UI_COLORS.NEUTRAL_200,
        opacity: cardOpacity
      }}
    >
      {/* Header - Always visible */}
      <div className="flex items-center justify-between gap-2">
        {/* Title - editable on double-click */}
        {isEditingName ? (
          <input
            type="text"
            value={editingValue}
            onChange={(e) => setEditingValue(e.target.value)}
            onBlur={handleSaveName}
            onKeyDown={handleEditKeyDown}
            autoFocus
            className="flex-1 text-sm font-medium px-2 py-1 rounded outline-none focus:ring-1"
            style={{
              backgroundColor: UI_COLORS.NEUTRAL_100,
              borderColor: UI_COLORS.PRIMARY,
              borderRadius: '8px',
              color: textColor
            }}
          />
        ) : (
          <div
            onDoubleClick={handleDoubleClickName}
            onClick={() => {
              onToggleExpand(index);
              onSelectCard?.();
            }}
            className="flex-1 text-left text-sm font-medium truncate cursor-pointer transition-opacity group"
            style={{ color: textColor }}
            title="Double-click to edit name"
          >
            {displayName}
            <span className="text-[10px] ml-1 opacity-0 group-hover:opacity-50 transition-opacity">✏️</span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">

          {/* Reset button - only show if sound is generated */}
          {isGenerated && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReset(index);
              }}
              className="w-5 h-5 flex items-center justify-center rounded-full transition-colors"
              style={{
                color: UI_COLORS.NEUTRAL_600
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_200;
                e.currentTarget.style.color = UI_COLORS.NEUTRAL_900;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = UI_COLORS.NEUTRAL_600;
              }}
              title="Reset to generation UI"
            >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            </button>
          )}


          {/* Link to entity button - show if model has entities OR if Speckle viewer is active */}
          {(modelEntities.length > 0 || useSpeckleViewer) && (
            <button
              onClick={() => {
                if (isLinkingEntity && linkingConfigIndex === index) {
                  onCancelLinkingEntity?.();
                } else {
                  onStartLinkingEntity?.(index);
                }
              }}
              className="w-5 h-5 flex items-center justify-center rounded-full transition-colors"
              style={{
                backgroundColor: isLinkingEntity && linkingConfigIndex === index ? UI_COLORS.PRIMARY : 'transparent',
                color: isLinkingEntity && linkingConfigIndex === index 
                  ? 'white' 
                  : config.entity 
                  ? UI_COLORS.SUCCESS 
                  : UI_COLORS.NEUTRAL_500
              }}
              title={
                isLinkingEntity && linkingConfigIndex === index
                  ? 'Cancel linking'
                  : config.entity
                  ? `Linked to entity ${config.entity.index}`
                  : 'Link to entity'
              }
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </button>
          )}


          {/* Mute button - compact, only show if generated */}
          {isGenerated && onMute && generatedSound && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onMute(generatedSound.id);
              }}
              className="w-5 h-5 flex items-center justify-center rounded-full transition-colors"
              style={{
                backgroundColor: isMuted ? `${UI_COLORS.WARNING}20` : 'transparent',
                color: isMuted ? UI_COLORS.WARNING : UI_COLORS.NEUTRAL_500
              }}
              onMouseEnter={(e) => {
                if (!isMuted) {
                  e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_200;
                }
              }}
              onMouseLeave={(e) => {
                if (!isMuted) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {isMuted ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                )}
              </svg>
            </button>
          )}

          {/* Solo button - compact, only show if generated */}
          {isGenerated && onSolo && generatedSound && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSolo(generatedSound.id);
              }}
              className="w-5 h-5 flex items-center justify-center rounded-full transition-colors"
              style={{
                backgroundColor: isSoloed ? `${UI_COLORS.PRIMARY}20` : 'transparent',
                color: isSoloed ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_500
              }}
              onMouseEnter={(e) => {
                if (!isSoloed) {
                  e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_200;
                }
              }}
              onMouseLeave={(e) => {
                if (!isSoloed) {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
              title={isSoloed ? 'Unsolo' : 'Solo'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill={isSoloed ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </button>
          )}

          {/* Close button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(index);
            }}
            className="w-5 h-5 flex items-center justify-center text-lg rounded-full transition-colors leading-none"
            style={{
              color: UI_COLORS.NEUTRAL_600
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = UI_COLORS.ERROR;
              e.currentTarget.style.backgroundColor = `${UI_COLORS.ERROR}10`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = UI_COLORS.NEUTRAL_600;
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            title="Remove sound"
          >
            ×
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="mt-3 space-y-3">
          {/* If sound is generated, show playback controls with WaveSurfer */}
          {isGenerated && generatedSound ? (
            <>
              {/* Main content: Waveform + Vertical Sliders */}
              <div className="flex gap-3">
                {/* Waveform area */}
                <div className="flex-1">
                  <SoundCardWaveSurfer
                    audioUrl={generatedSound.url}
                    volumeDb={currentVolumeDb}
                    isPlaying={isPreviewPlaying}
                    isMuted={isMuted}
                    onPlayPause={() => onPreviewPlayPause?.(generatedSound.id)}
                    onStop={() => onPreviewStop?.(generatedSound.id)}
                    color={UI_COLORS.PRIMARY}
                  />
                  {/* Variant Selector - bottom left under waveform */}
                  {variants.length > 1 && onVariantChange && (
                    <div className="flex gap-1 mt-1">
                      {variants.map((_, idx) => (
                        <button
                          key={idx}
                          onClick={() => onVariantChange(index, idx)}
                          className="w-5 h-5 text-[10px] rounded transition-colors"
                          style={{
                            backgroundColor: idx === selectedVariantIdx ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_700,
                            color: idx === selectedVariantIdx ? 'white' : UI_COLORS.NEUTRAL_300,
                            borderRadius: '4px'
                          }}
                        >
                          {idx + 1}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Vertical sliders container */}
                <div className="flex gap-2">
                  {/* Interval slider */}
                  {onIntervalChange && (
                    <div
                      className="flex flex-col items-center"
                      title="Playback interval: Time between sound repetitions in the timeline. Set to 0 for continuous loop."
                    >
                      <span className="text-[10px] mb-1" style={{ color: UI_COLORS.NEUTRAL_400 }}>
                        {tempIntervalSeconds === 0 ? '∞' : `${tempIntervalSeconds}s`}
                      </span>
                      <VerticalVolumeSlider
                        value={tempIntervalSeconds / UI_INTERVAL_SLIDER.MAX}
                        onChange={(v) => setTempIntervalSeconds(Math.round(v * UI_INTERVAL_SLIDER.MAX))}
                        onChangeCommitted={(v) => onIntervalChange(generatedSound.id, Math.round(v * UI_INTERVAL_SLIDER.MAX))}
                      />
                      <span className="text-[10px] mt-1" style={{ color: UI_COLORS.NEUTRAL_500 }}>Int.</span>
                    </div>
                  )}

                  {/* Volume slider */}
                  {onVolumeChange && (
                    <div
                      className="flex flex-col items-center"
                      title="Volume level: Controls the sound pressure level (SPL) in decibels for spatial audio playback."
                    >
                      <span className="text-[10px] mb-1" style={{ color: UI_COLORS.NEUTRAL_400 }}>
                        {currentVolumeDb.toFixed(0)}dB
                      </span>
                      <VerticalVolumeSlider
                        value={(currentVolumeDb - UI_VOLUME_SLIDER.MIN) / (UI_VOLUME_SLIDER.MAX - UI_VOLUME_SLIDER.MIN)}
                        onChange={(v) => onVolumeChange(generatedSound.id, UI_VOLUME_SLIDER.MIN + v * (UI_VOLUME_SLIDER.MAX - UI_VOLUME_SLIDER.MIN))}
                      />
                      <span className="text-[10px] mt-1" style={{ color: UI_COLORS.NEUTRAL_500 }}>Vol.</span>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* If not generated, show generation UI */}
              {/* Entity linking status */}
              {isLinkingEntity && linkingConfigIndex === index && (
                <div 
                  className="rounded text-xs"
                  style={{
                    padding: '8px',
                    backgroundColor: UI_COLORS.INFO_LIGHT,
                    borderColor: UI_COLORS.INFO,
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    borderRadius: '8px',
                    color: UI_COLORS.INFO
                  }}
                >
                  <div className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Click on an entity in the 3D view to link this sound</span>
                  </div>
                </div>
              )}

              {/* Linked entity info */}
              {config.entity && (
                <div 
                  className="rounded text-xs"
                  style={{
                    padding: '8px',
                    backgroundColor: UI_COLORS.SUCCESS_LIGHT,
                    borderColor: UI_COLORS.SUCCESS,
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    borderRadius: '8px',
                    color: UI_COLORS.SUCCESS
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>
                        Linked to entity: {config.entity.name || `Entity ${config.entity.index}`}
                      </span>
                    </div>
                    <button
                      onClick={() => onUpdateConfig(index, 'entity' as any, undefined as any)}
                      style={{ color: UI_COLORS.SUCCESS }}
                      title="Unlink entity"
                    >
                      ×
                    </button>
                  </div>
                </div>
              )}

              {/* Mode-specific UI */}
              {currentMode === 'text-to-audio' && (
                <>
                  <textarea
                    value={config.prompt}
                    onChange={(e) => onUpdateConfig(index, 'prompt', e.target.value)}
                    placeholder="e.g., Hammer hitting wooden table"
                    className="w-full h-16 p-2 text-sm rounded"
                    style={{
                      backgroundColor: 'white',
                      borderColor: UI_COLORS.NEUTRAL_300,
                      borderWidth: '1px',
                      borderStyle: 'solid',
                      borderRadius: '8px'
                    }}
                    rows={2}
                  />

                  <div className="grid grid-cols-2 gap-2">

                    <RangeSlider
                      label="Duration (s): "
                      value={config.duration}
                      min={1}
                      max={30}
                      step={1}
                      onChange={(value) => onUpdateConfig(index,'duration', value)}
                      showLabels={false}
                    />
                    
                    <RangeSlider
                      label="Guidance: "
                      value={config.guidance_scale ?? 4.5}
                      min={0}
                      max={10}
                      step={0.5}
                      onChange={(value) => onUpdateConfig(index,'guidance_scale', value)}
                      showLabels={false}
                      hoverText='Low guidance = AI model can get creative, but follows less your prompts'
                    />
                  </div>

                  <RangeSlider
                      label="Number of variants: "
                      value={config.seed_copies}
                      min={1}
                      max={5}
                      step={1}
                      onChange={(value) => onUpdateConfig(index,'seed_copies', value)}
                      showLabels={false}
                      hoverText='This will generate multiple variants of sounds from your prompt'
                    />
                </>
              )}

              {currentMode === 'upload' && (
                <>
                  {!hasUploadedAudio ? (
                    <FileUploadArea
                      file={uploadFile}
                      isDragging={isDragging}
                      acceptedFormats="audio/*,.wav,.mp3,.ogg,.flac"
                      acceptedExtensions=".wav, .mp3, .ogg, .flac"
                      onFileChange={handleFileChange}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      inputId={`sound-upload-${index}`}
                      multiple={false}
                    />
                  ) : (
                    <div className="space-y-2">
                      {config.uploadedAudioBuffer && config.uploadedAudioInfo && (
                        <AudioWaveformDisplay
                          audioBuffer={config.uploadedAudioBuffer}
                          audioInfo={config.uploadedAudioInfo}
                        />
                      )}

                      <button
                        onClick={handleClearAudio}
                        className="w-full text-xs py-1.5 px-3 text-white rounded transition-colors"
                        style={{
                          backgroundColor: UI_COLORS.NEUTRAL_500,
                          borderRadius: '8px'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_600}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_500}
                      >
                        Clear Uploaded Audio
                      </button>
                    </div>
                  )}
                </>
              )}

              {currentMode === 'library' && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <textarea
                      value={config.prompt}
                      onChange={(e) => onUpdateConfig(index, 'prompt', e.target.value)}
                      placeholder="e.g., Urban traffic, birds chirping, footsteps"
                      className="flex-1 h-12 p-2 text-sm rounded"
                      style={{
                        backgroundColor: 'white',
                        borderColor: UI_COLORS.NEUTRAL_300,
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderRadius: '8px'
                      }}
                      rows={2}
                    />
                    <button
                      onClick={() => onLibrarySearch?.(index)}
                      disabled={!config.prompt.trim() || config.librarySearchState?.isSearching}
                      className="px-4 py-2 text-xs font-medium text-white rounded transition-colors disabled:cursor-not-allowed"
                      style={{
                        backgroundColor: !config.prompt.trim() || config.librarySearchState?.isSearching ? UI_COLORS.NEUTRAL_400 : UI_COLORS.PRIMARY,
                        borderRadius: '8px',
                        opacity: !config.prompt.trim() || config.librarySearchState?.isSearching ? 0.4 : 1
                      }}
                    >
                      {config.librarySearchState?.isSearching ? 'Searching...' : 'Search'}
                    </button>
                  </div>

                  {config.librarySearchState?.results && config.librarySearchState.results.length > 0 && (
                    <div
                      className="rounded p-2 max-h-64 overflow-y-auto"
                      style={{
                        backgroundColor: 'white',
                        borderRadius: '8px'
                      }}
                    >
                      <p className="text-xs font-medium mb-2" style={{ color: UI_COLORS.NEUTRAL_700 }}>
                        Found {config.librarySearchState.results.length} results:
                      </p>
                      <div className="space-y-1">
                        {config.librarySearchState.results.map((result) => (
                          <button
                            key={result.location}
                            onClick={() => onLibrarySoundSelect?.(index, result)}
                            className="w-full text-left p-2 rounded text-xs transition-colors"
                            style={{
                              backgroundColor: config.selectedLibrarySound?.location === result.location ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_100,
                              color: config.selectedLibrarySound?.location === result.location ? 'white' : UI_COLORS.NEUTRAL_700,
                              borderRadius: '8px'
                            }}
                          >
                            <div className="font-medium truncate">{result.description}</div>
                            <div className="text-[10px] opacity-75 flex justify-between mt-0.5">
                              <span>{result.category}</span>
                              <span>{result.duration}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {config.librarySearchState?.results && config.librarySearchState.results.length === 0 && !config.librarySearchState.isSearching && (
                    <p className="text-xs text-center py-4" style={{ color: UI_COLORS.NEUTRAL_500 }}>
                      No sounds found. Try a different search term.
                    </p>
                  )}

                  {config.librarySearchState?.error && (
                    <p
                      className="text-xs rounded p-2"
                      style={{
                        backgroundColor: UI_COLORS.ERROR_LIGHT,
                        borderColor: UI_COLORS.ERROR,
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderRadius: '8px',
                        color: UI_COLORS.ERROR
                      }}
                    >
                      {config.librarySearchState.error}
                    </p>
                  )}

                  {!config.librarySearchState?.results && !config.librarySearchState?.isSearching && (
                    <p className="text-xs italic" style={{ color: UI_COLORS.NEUTRAL_500 }}>
                      Enter search terms and click "Search" to find sounds from the BBC Sound Effects library
                    </p>
                  )}
                </div>
              )}

              {currentMode === 'sample-audio' && (
                <div className="space-y-2">
                  {config.uploadedAudioBuffer && config.uploadedAudioInfo && (
                    <AudioWaveformDisplay
                      audioBuffer={config.uploadedAudioBuffer}
                      audioInfo={config.uploadedAudioInfo}
                    />
                  )}

                  <button
                    onClick={handleClearAudio}
                    className="w-full text-xs py-1.5 px-3 text-white rounded transition-colors"
                    style={{
                      backgroundColor: UI_COLORS.NEUTRAL_500,
                      borderRadius: '8px'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_600}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = UI_COLORS.NEUTRAL_500}
                  >
                    Clear Sample Audio
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
