'use client';

import type { SoundGenerationConfig, LibrarySearchResult, CatalogSoundSelection } from '@/types';
import { TextToAudioMode } from './TextToAudioMode';
import { TextToSpeechMode } from './TextToSpeechMode';
import { UploadMode } from './UploadMode';
import { LibraryMode } from './LibraryMode';
import { CatalogMode } from './CatalogMode';
import type { CatalogBrowseState, CatalogBrowseActions } from '@/hooks/useCatalogBrowse';
import { SampleAudioMode } from './SampleAudioMode';

/**
 * SoundConfigContent Component
 *
 * Renders the configuration UI for sound generation before a sound is generated.
 * Orchestrates different type components based on config.type (CardType).
 *
 * This is the `beforeContent` for the Sound Card component.
 */

export interface SoundConfigContentProps {
  config: SoundGenerationConfig;
  index: number;
  isSoundGenerating: boolean;
  isLinkingEntity: boolean;
  linkingConfigIndex: number | null;
  /** When true, TextToAudioMode renders only the textarea (sliders shown separately as collapsible). */
  hideTextToAudioSliders?: boolean;
  onUpdateConfig: (index: number, field: keyof SoundGenerationConfig, value: any) => void;
  onUploadAudio?: (index: number, file: File) => Promise<void>;
  onClearUploadedAudio?: (index: number) => void;
  onLibrarySearch?: (index: number) => Promise<void>;
  onLibrarySoundSelect?: (index: number, sound: LibrarySearchResult) => void;
  onCatalogSoundSelect?: (index: number, sound: CatalogSoundSelection) => void;
  /** Shared catalog search state from SoundPreContent, so SearchBar renders full-width. */
  catalogState?: CatalogBrowseState & CatalogBrowseActions;
  /** Controlled preview state for upload/sample-audio modes — owned by the parent so previews are mutually exclusive. */
  isPreviewPlaying?: boolean;
  onPreviewPlayPause?: () => void;
  onPreviewStop?: () => void;
}

export function SoundConfigContent({
  config,
  index,
  isSoundGenerating,
  isLinkingEntity,
  linkingConfigIndex,
  onUpdateConfig,
  onUploadAudio,
  onClearUploadedAudio,
  onLibrarySearch,
  onLibrarySoundSelect,
  onCatalogSoundSelect,
  hideTextToAudioSliders,
  catalogState,
  isPreviewPlaying,
  onPreviewPlayPause,
  onPreviewStop,
}: SoundConfigContentProps) {
  const cardType = config.type || 'text-to-audio';

  return (
    <div className="space-y-3">
      {/* Type-specific UI based on CardType */}
      {cardType === 'text-to-audio' && (
        <TextToAudioMode
          config={config}
          index={index}
          onUpdateConfig={onUpdateConfig}
          hideSliders={hideTextToAudioSliders}
        />
      )}

      {cardType === 'text-to-speech' && (
        <TextToSpeechMode
          config={config}
          index={index}
          onUpdateConfig={onUpdateConfig}
        />
      )}

      {cardType === 'upload' && (
        <UploadMode
          config={config}
          index={index}
          onUploadAudio={onUploadAudio}
          onClearUploadedAudio={onClearUploadedAudio}
          isPreviewPlaying={isPreviewPlaying}
          onPreviewPlayPause={onPreviewPlayPause}
          onPreviewStop={onPreviewStop}
        />
      )}

      {cardType === 'library' && (
        <LibraryMode
          config={config}
          index={index}
          onUpdateConfig={onUpdateConfig}
          onLibrarySearch={onLibrarySearch}
          onLibrarySoundSelect={onLibrarySoundSelect}
        />
      )}

      {cardType === 'catalog' && (
        <CatalogMode
          config={config}
          index={index}
          onUpdateConfig={onUpdateConfig}
          onCatalogSoundSelect={onCatalogSoundSelect}
          catalogState={catalogState}
        />
      )}

      {cardType === 'sample-audio' && (
        <SampleAudioMode
          config={config}
          index={index}
          onClearUploadedAudio={onClearUploadedAudio}
          isPreviewPlaying={isPreviewPlaying}
          onPreviewPlayPause={onPreviewPlayPause}
          onPreviewStop={onPreviewStop}
        />
      )}
    </div>
  );
}

// ============================================================================
// Helper sub-components
// ============================================================================
