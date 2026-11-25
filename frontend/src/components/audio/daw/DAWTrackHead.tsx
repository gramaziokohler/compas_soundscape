'use client';

import { useCanEdit } from '@/hooks/useCanEdit';
import { useCallback, useRef, memo } from 'react';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { DAW, DEFAULT_DBFS, SOUND_CATEGORIES, soundCategoryTooltip } from '@/utils/constants';
import type { TimelineSound } from '@/types/audio';

/** Where the dock opens the track menu (kebab click or right-click on the head). */
export interface DAWTrackMenuRequest {
  /** Top-left point of the menu. */
  x: number;
  y: number;
  /** Kebab: the menu flips above the button near the screen bottom. */
  flipBottomY?: number;
  /** Bottom-left corner of the "Interval settings" popover. */
  panelAnchor: { x: number; y: number };
  /** Where the first-person "can't zoom" hint points: the head's right edge, mid-height. */
  hintAnchor: DAWHintAnchor;
}

export interface DAWHintAnchor {
  left: number;
  centerY: number;
}

interface DAWTrackHeadProps {
  sound: TimelineSound;
  displayName: string;
  groupLabel: string;
  clipCount: number;
  /** Number of iterations excluded by the orchestrate solver for this track. */
  excludedCount?: number;
  trackHeight: number;
  isMuted: boolean;
  isSoloed: boolean;
  volumeDbfs: number;
  onMute: () => void;
  onSolo: () => void;
  onVolumeChange: (dbfs: number) => void;
  onSelectSoundCard?: () => void;
  /** Kebab "Open sound card": reveal the card in its sound scene (opens a collapsed scene). */
  onOpenSoundCard?: () => void;
  /** This track's sound is the shared sound focus (sphere / card / track click). */
  isFocused?: boolean;
  /** Open the track menu (kebab or right-click). Absent in the share view. */
  onOpenMenu?: (request: DAWTrackMenuRequest) => void;
  /** Name double-click: zoom the 3D view to the linked entity (the dock shows the
   * first-person hint at `hintAnchor` when zooming is impossible). */
  onZoomToEntity?: (hintAnchor: DAWHintAnchor) => void;
  onHoverTrack?: () => void;
  onHoverTrackEnd?: () => void;
}

function DAWTrackHeadImpl({
  sound,
  displayName,
  groupLabel,
  clipCount,
  excludedCount,
  trackHeight,
  isMuted,
  isSoloed,
  volumeDbfs,
  onMute,
  onSolo,
  onVolumeChange,
  onSelectSoundCard,
  isFocused = false,
  onOpenMenu,
  onZoomToEntity,
  onHoverTrack,
  onHoverTrackEnd,
}: DAWTrackHeadProps) {
  // Share view: mute / solo only — no track menu (distribute, clear, reset) or volume.
  const canEdit = useCanEdit();
  const kebabRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const hintAnchor = useCallback((): DAWHintAnchor => {
    const rect = rootRef.current?.getBoundingClientRect();
    return rect ? { left: rect.right, centerY: rect.top + rect.height / 2 } : { left: 0, centerY: 0 };
  }, []);

  const openKebabMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = kebabRef.current?.getBoundingClientRect();
    if (!rect || !onOpenMenu) return;
    onOpenMenu({
      x: rect.right + 4, y: rect.top, flipBottomY: rect.bottom,
      panelAnchor: { x: rect.right, y: rect.top }, hintAnchor: hintAnchor(),
    });
  }, [onOpenMenu, hintAnchor]);

  // Right-click anywhere on the head opens the same menu at the cursor.
  const openContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canEdit || !onOpenMenu) return;
    onOpenMenu({ x: e.clientX, y: e.clientY, panelAnchor: { x: e.clientX, y: e.clientY }, hintAnchor: hintAnchor() });
  }, [canEdit, onOpenMenu, hintAnchor]);

  const showSubLabel = trackHeight >= DAW.TRACK_HEIGHT_SUBLABEL_MIN;
  // Same colour as the sound card's category badge; neutral when uncategorized.
  const categoryColor = sound.soundGroup ? SOUND_CATEGORIES[sound.soundGroup].color : 'var(--color-secondary-hover)';

  return (
    <div
      ref={rootRef}
      style={{
        width: `${DAW.HEAD_WIDTH}px`,
        height: `${trackHeight}px`,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 'var(--card-space-xxs)',
        padding: 'var(--card-space-xs) var(--card-space-sm)',
        borderRight: '1px solid var(--color-border-strong)',
        borderBottom: '1px solid var(--color-border)',
        position: 'sticky',
        left: 0,
        zIndex: 60,
        overflow: 'hidden',
        // Focused sound: primary tint + left accent bar.
        backgroundColor: isFocused ? 'var(--color-primary-lighter)' : undefined,
        boxShadow: isFocused ? 'inset 3px 0 0 var(--color-primary)' : undefined,
      }}
      data-focused={isFocused || undefined}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={openContextMenu}
      onMouseEnter={onHoverTrack}
      onMouseLeave={onHoverTrackEnd}
    >
      {/* Frosted backdrop — lanes/clips scrolling horizontally behind the sticky
          head column are hidden behind the same glass treatment as the dock.
          Kept on its own layer (not a backdrop-filter on the root) so nothing
          position:fixed inside the head is captured by a containing block. */}
      <div
        aria-hidden="true"
        className="backdrop-blur-lg backdrop-saturate-150"
        style={{ position: 'absolute', inset: 0, zIndex: -1, pointerEvents: 'none' }}
      />
      {/* Row 1: badge, name, kebab */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--card-space-xs)' }}>
        <span
          title={soundCategoryTooltip(sound.soundGroup)}
          style={{
            display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%',
            backgroundColor: categoryColor, flexShrink: 0, cursor: 'help',
          }}
        />
        <span
          title={displayName}
          onClick={onSelectSoundCard}
          onDoubleClick={onZoomToEntity ? () => onZoomToEntity(hintAnchor()) : undefined}
          style={{
            fontSize: '10px', fontWeight: 600, color: 'var(--foreground)', flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            cursor: onSelectSoundCard ? 'pointer' : 'default', lineHeight: 1.2,
          }}
        >
          {displayName}
        </span>
        {(excludedCount ?? 0) > 0 && (
          <span
            title={`${excludedCount} iteration(s) excluded — timing link could not be satisfied`}
            style={{
              fontSize: '8px', fontWeight: 700, lineHeight: 1, color: 'var(--color-error)',
              border: '1px solid var(--color-error)', borderRadius: '3px', padding: '1px 3px',
              flexShrink: 0,
            }}
          >
            {excludedCount}!
          </span>
        )}
        {canEdit && onOpenMenu && (
        <button
          ref={kebabRef}
          onClick={openKebabMenu}
          title="Track options"
          style={{
            width: 14, height: 14, border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--color-secondary-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
            flexShrink: 0,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
          </svg>
        </button>
        )}
      </div>

      {/* Row 2: sub-label — hidden when the track is too short to fit it */}
      {showSubLabel && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--card-space-xs)' }}>
          <span style={{ fontSize: '8px', color: 'var(--color-secondary-hover)', opacity: 0.75, whiteSpace: 'nowrap' }}>
            {groupLabel} · {clipCount} clip{clipCount === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {/* Row 3: M/S + fader */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--card-space-xs)' }}>
        <button
          onClick={(e) => { e.stopPropagation(); onMute(); }}
          title={isMuted ? 'Unmute' : 'Mute'}
          style={{
            fontSize: '8px', padding: '1px 4px', borderRadius: '2px', border: 'none', cursor: 'pointer',
            backgroundColor: isMuted ? 'var(--color-error)' : 'var(--color-secondary-light)',
            color: isMuted ? 'var(--color-on-blue)' : 'var(--color-error)', fontWeight: 600, lineHeight: 1.5, flexShrink: 0,
          }}
        >
          M
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onSolo(); }}
          title={isSoloed ? 'Unsolo' : 'Solo'}
          style={{
            fontSize: '8px', padding: '1px 4px', borderRadius: '2px', border: 'none', cursor: 'pointer',
            // Same yellow as a selected sound sphere (useSpeckleSoundHighlight).
            backgroundColor: isSoloed ? 'var(--color-warning)' : 'var(--color-secondary-light)',
            color: isSoloed ? 'var(--color-on-warning)' : 'var(--color-warning)', fontWeight: 600, lineHeight: 1.5, flexShrink: 0,
          }}
        >
          S
        </button>
        {canEdit && (
        <div style={{ flex: 1, minWidth: 0 }}>
          <RangeSlider
            label=""
            value={volumeDbfs}
            min={-60}
            max={0}
            step={1}
            unit="dB"
            precision={0}
            onChange={onVolumeChange}
            defaultValue={DEFAULT_DBFS}
            hoverText="Double-click to reset"
          />
        </div>
        )}
      </div>
    </div>
  );
}

export const DAWTrackHead = memo(DAWTrackHeadImpl);
