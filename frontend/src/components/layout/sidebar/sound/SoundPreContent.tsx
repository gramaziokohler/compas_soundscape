'use client';

import { DEFAULT_DBFS } from '@/utils/constants';
import { SoundConfigContent, type SoundConfigContentProps } from './SoundConfigContent';
import { SoundCardBody } from './SoundCardBody';
import { SearchBar } from '@/components/ui/SearchBar';
import { useCatalogBrowse, type CatalogBrowseState, type CatalogBrowseActions } from '@/hooks/useCatalogBrowse';

interface SoundPreContentProps extends SoundConfigContentProps {}

/**
 * SoundPreContent
 *
 * Pre-generation sound card content. Wraps the mode-specific configuration UI
 * (TextToAudioMode, UploadMode, LibraryMode, etc.) with the shared controls
 * layout: volume slider, interval slider/timestamps, and position x/y/z widget.
 *
 * Layout (left column):
 *   1. x/y/z position widget (always visible)
 *   2. The type-specific UI (textarea, upload area, etc.) — text-to-audio
 *      sliders are collapsed under an "Additional settings" toggle inside
 *      TextToAudioMode.
 *
 * This is the `beforeContent` for the Sound Card component.
 * SoundResultContent is the `afterContent`.
 */
export function SoundPreContent(props: SoundPreContentProps) {
  const { config, index, onUpdateConfig, ...configProps } = props;

  // ── Derive shared-control values from config ──────────────────────────────
  const volumeDbfs = config.dbfs ?? DEFAULT_DBFS;

  // ── Scheduling defaults (pre-generation) ──────────────────────────────────
  const intervalSeconds = config.interval_seconds ?? 30;
  const schedulingMode: 'interval' | 'timestamps' = 'interval';
  const timestamps: number[] = [];

  // Entity is linked when config.entity exists
  const entityIndex: number | undefined = config.entity
    ? (typeof config.entity.index === 'number' ? config.entity.index : -1)
    : undefined;

  // Position to display: entity bbox center when linked, explicit override otherwise.
  const displayedPosition: [number, number, number] | undefined = config.entity
    ? (() => {
        const ec = config.entity!;
        if (ec.bounds?.center) return ec.bounds.center as [number, number, number];
        if (Array.isArray(ec.position) && ec.position.length >= 3)
          return [ec.position[0], ec.position[1], ec.position[2]] as [number, number, number];
        return undefined;
      })()
    : config.position;

  // ── Callbacks ─────────────────────────────────────────────────────────────

  const handleVolumeChange = (dbfs: number) => onUpdateConfig(index, 'dbfs', dbfs);

  const handleUpdatePosition = (pos: [number, number, number]) =>
    onUpdateConfig(index, 'position', pos);

  const handleUnlinkEntity = () =>
    onUpdateConfig(index, 'entity' as any, undefined as any);

  const currentType = config.type || 'text-to-audio';

  // ── Catalog search state (lifted so SearchBar can render full-width) ───────
  const catalogBrowse = useCatalogBrowse();
  const isCatalog = currentType === 'catalog';
  const catalogSearchState: (CatalogBrowseState & CatalogBrowseActions) | undefined = isCatalog ? catalogBrowse : undefined;

  const fullWidthHeader = isCatalog ? (
    <SearchBar
      value={catalogBrowse.searchQuery}
      onChange={(v) => catalogBrowse.setSearchQuery(v)}
      placeholder="Search sounds..."
      isLoading={catalogBrowse.isSearchingAll}
    />
  ) : undefined;

  // For text-to-audio: render just the textarea; sliders go in an "Additional
  // settings" collapse inside TextToAudioMode.
  const isTextToAudio = currentType === 'text-to-audio';

  return (
    <SoundCardBody
      fullWidthHeader={fullWidthHeader}
      mainContent={
        <SoundConfigContent
          config={config}
          index={index}
          onUpdateConfig={onUpdateConfig}
          hideTextToAudioSliders={isTextToAudio}
          catalogState={catalogSearchState}
          {...configProps}
        />
      }
      volumeDbfs={volumeDbfs}
      intervalSeconds={intervalSeconds}
      schedulingMode={schedulingMode}
      timestamps={timestamps}
      position={displayedPosition}
      entityIndex={entityIndex}
      onVolumeChange={handleVolumeChange}
      onUpdatePosition={handleUpdatePosition}
      onUnlinkEntity={handleUnlinkEntity}
      storeContext="soundscape"
    />
  );
}

