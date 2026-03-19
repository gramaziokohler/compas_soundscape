'use client';

import type { SoundGenerationConfig, LibrarySearchResult, CatalogSoundSelection } from '@/types';
import { TextToAudioMode } from './TextToAudioMode';
import { UploadMode } from './UploadMode';
import { LibraryMode } from './LibraryMode';
import { CatalogMode } from './CatalogMode';
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
  onUpdateConfig: (index: number, field: keyof SoundGenerationConfig, value: any) => void;
  onUploadAudio?: (index: number, file: File) => Promise<void>;
  onClearUploadedAudio?: (index: number) => void;
  onLibrarySearch?: (index: number) => Promise<void>;
  onLibrarySoundSelect?: (index: number, sound: LibrarySearchResult) => void;
  onCatalogSoundSelect?: (index: number, sound: CatalogSoundSelection) => void;
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
}: SoundConfigContentProps) {
  const cardType = config.type || 'text-to-audio';

  return (
    <div className="space-y-3">
      {/* Entity linking status */}
      {isLinkingEntity && linkingConfigIndex === index && (
        <EntityLinkingStatus />
      )}

      {/* Linked entity info */}
      {config.entity && (
        <LinkedEntityInfo
          entity={config.entity}
          onUnlink={() => onUpdateConfig(index, 'entity' as any, undefined as any)}
        />
      )}

      {/* Type-specific UI based on CardType */}
      {cardType === 'text-to-audio' && (
        <TextToAudioMode
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
          onCatalogSoundSelect={onCatalogSoundSelect}
        />
      )}

      {cardType === 'sample-audio' && (
        <SampleAudioMode
          config={config}
          index={index}
          onClearUploadedAudio={onClearUploadedAudio}
        />
      )}
    </div>
  );
}

// ============================================================================
// Helper sub-components
// ============================================================================

function EntityLinkingStatus() {
  return (
    <div className="rounded-lg p-2 text-xs bg-info-light border border-info text-info">
      <div className="flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>Click on an entity in the 3D view to link this sound</span>
      </div>
    </div>
  );
}

interface LinkedEntityInfoProps {
  entity: { name?: string; index: number };
  onUnlink: () => void;
}

function LinkedEntityInfo({ entity, onUnlink }: LinkedEntityInfoProps) {
  return (
    <div className="rounded-lg p-2 text-xs bg-success-light border border-success text-success">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>Linked to entity: {entity.name || `Entity ${entity.index}`}</span>
        </div>
        <button
          onClick={onUnlink}
          className="text-success hover:opacity-70"
          title="Unlink entity"
        >
          ×
        </button>
      </div>
    </div>
  );
}
