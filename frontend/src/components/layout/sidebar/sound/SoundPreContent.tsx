'use client';

import { SoundConfigContent, type SoundConfigContentProps } from './SoundConfigContent';
import { SoundCardBody } from './SoundCardBody';

/**
 * SoundPreContent
 *
 * Pre-generation sound card content. Wraps the mode-specific configuration UI
 * (TextToAudioMode, UploadMode, LibraryMode, etc.) with the same shared controls
 * layout used by SoundResultContent: volume slider, interval slider/timestamps,
 * and position x/y/z widget.
 *
 * This is the `beforeContent` for the Sound Card component.
 * SoundResultContent is the `afterContent`.
 */
export function SoundPreContent(props: SoundConfigContentProps) {
  const { config, index, onUpdateConfig } = props;

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

  // Entity is linked when config.entity exists — foley entities have string id/applicationId
  // but no numeric index. Use existence of config.entity as the signal.
  // SoundCardBody uses entityIndex !== undefined to disable position inputs.
  const entityIndex: number | undefined = config.entity
    ? (typeof config.entity.index === 'number' ? config.entity.index : -1)
    : undefined;

  // Position to display: entity bbox center when linked, explicit override otherwise.
  // This keeps the position widget read-only and shows the correct value.
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

  return (
    <SoundCardBody
      mainContent={<SoundConfigContent {...props} />}
      volumeDb={volumeDb}
      intervalSeconds={intervalSeconds}
      schedulingMode={schedulingMode}
      timestamps={timestamps}
      position={displayedPosition}
      entityIndex={entityIndex}
      onVolumeChange={handleVolumeChange}
      onIntervalChange={handleIntervalChange}
      onTimestampsChange={handleTimestampsChange}
      onUpdatePosition={handleUpdatePosition}
      storeContext="soundscape"
    />
  );
}
