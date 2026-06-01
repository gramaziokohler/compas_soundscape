'use client';

import type { CardType } from '@/types';
import { SoundConfigContent, type SoundConfigContentProps } from './SoundConfigContent';
import { TextToAudioSliders } from './TextToAudioMode';
import { SoundCardBody } from './SoundCardBody';

interface MethodOption {
  type: CardType;
  label: string;
  enabled: boolean;
}

interface SoundPreContentProps extends SoundConfigContentProps {
  availableTypes?: MethodOption[];
  onSwitchType?: (index: number, type: CardType) => void;
}

/**
 * SoundPreContent
 *
 * Pre-generation sound card content. Wraps the mode-specific configuration UI
 * (TextToAudioMode, UploadMode, LibraryMode, etc.) with the shared controls
 * layout: volume slider, interval slider/timestamps, and position x/y/z widget.
 *
 * Layout (left column):
 *   1. x/y/z position widget (always visible)
 *   2. Method selector row: "Method: <dropdown> v"  (collapsed by default)
 *   3. Collapsible panel with the type-specific UI
 *
 * This is the `beforeContent` for the Sound Card component.
 * SoundResultContent is the `afterContent`.
 */
export function SoundPreContent(props: SoundPreContentProps) {
  const { config, index, onUpdateConfig, availableTypes, onSwitchType, ...configProps } = props;

  // ── Derive shared-control values from config ──────────────────────────────
  const volumeDb = config.spl_db ?? 70;
  const intervalSeconds = config.interval_seconds ?? 30;

  // Convert MM:SS timestamp strings → seconds for TimestampList
  const timestamps: number[] = config.timestamps?.map((ts) => {
    const [mm, ss] = ts.split(':').map(Number);
    return (mm ?? 0) * 60 + (ss ?? 0);
  }) ?? [];

  const schedulingMode: 'interval' | 'timestamps' =
    timestamps.length > 0 ? 'timestamps' : 'interval';

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

  const handleVolumeChange = (db: number) => onUpdateConfig(index, 'spl_db', db);
  const handleIntervalChange = (sec: number) => onUpdateConfig(index, 'interval_seconds', sec);

  const handleTimestampsChange = (ts: number[]) => {
    const formatted = ts.map((s) => {
      const mm = Math.floor(s / 60);
      const ss = s % 60;
      return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    });
    onUpdateConfig(index, 'timestamps', formatted);
  };

  const handleUpdatePosition = (pos: [number, number, number]) =>
    onUpdateConfig(index, 'position', pos);

  const handleUnlinkEntity = () =>
    onUpdateConfig(index, 'entity' as any, undefined as any);

  const currentType = config.type || 'text-to-audio';

  // For text-to-audio: render just the textarea in mainContent; sliders go in collapsible panel.
  // For other types: render the full mode UI, no collapsible.
  const isTextToAudio = currentType === 'text-to-audio';

  const collapsibleContent = isTextToAudio ? (
    <TextToAudioSliders config={config} index={index} onUpdateConfig={onUpdateConfig} />
  ) : undefined;

  return (
    <SoundCardBody
      mainContent={
        <SoundConfigContent
          config={config}
          index={index}
          onUpdateConfig={onUpdateConfig}
          hideTextToAudioSliders={isTextToAudio}
          {...configProps}
        />
      }
      collapsibleContent={collapsibleContent}
      volumeDb={volumeDb}
      intervalSeconds={intervalSeconds}
      schedulingMode={schedulingMode}
      timestamps={timestamps}
      position={displayedPosition}
      entityIndex={entityIndex}
      methodType={config.type || 'text-to-audio'}
      availableTypes={availableTypes}
      onSwitchType={onSwitchType ? (t) => onSwitchType(index, t) : undefined}
      onVolumeChange={handleVolumeChange}
      onIntervalChange={handleIntervalChange}
      onTimestampsChange={handleTimestampsChange}
      onUpdatePosition={handleUpdatePosition}
      onUnlinkEntity={handleUnlinkEntity}
      storeContext="soundscape"
    />
  );
}

