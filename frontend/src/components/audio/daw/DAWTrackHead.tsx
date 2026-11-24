'use client';

import { useCanEdit } from '@/hooks/useCanEdit';
import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { Icon } from '@/components/ui/Icon';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { DAW, DAW_FPS_ZOOM_HINT, DEFAULT_DBFS, POPUP_MENU, SOUND_CATEGORIES, soundCategoryTooltip } from '@/utils/constants';
import { useViewportClampedPosition } from '@/hooks/useViewportClampedPosition';
import type { TimelineSound } from '@/types/audio';

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
  /** Open the transient "Interval settings" popover, anchored so its bottom-left
   * corner touches the kebab button's top-right corner (anchor = kebab top-right). */
  onRequestDistribute: (anchor: { x: number; y: number }) => void;
  /** Recurring activity (LLM rhythm): the menu item reads "Interval settings". */
  isRecurring?: boolean;
  onSelectAllClips: () => void;
  onClearClips: () => void;
  onResetTrack: () => void;
  /** Zoom the 3D view to this track's linked entity — same action for the name's
   * double-click and the "Zoom to entity" menu item. */
  onZoomToEntity?: () => void;
  /** The 3D camera is locked to a listener's first-person view: zooming has no
   * effect, so a hint explains why instead of performing it. */
  isFirstPersonMode?: boolean;
  onClearEntityLinks: () => void;
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
  onOpenSoundCard,
  isFocused = false,
  onRequestDistribute,
  isRecurring = false,
  onSelectAllClips,
  onClearClips,
  onResetTrack,
  onZoomToEntity,
  isFirstPersonMode = false,
  onClearEntityLinks,
  onHoverTrack,
  onHoverTrackEnd,
}: DAWTrackHeadProps) {
  // Share view: mute / solo only — no track menu (distribute, clear, reset) or volume.
  const canEdit = useCanEdit();
  // `flipBottomY`: the kebab's bottom — near the screen bottom the menu opens upward.
  const [menuPos, setMenuPos] = useState<{ x: number; y: number; flipBottomY: number } | null>(null);
  const kebabRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const kebabAnchorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuPos) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuPos(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuPos]);

  const openMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = kebabRef.current?.getBoundingClientRect();
    if (!rect) return;
    kebabAnchorRef.current = { x: rect.right, y: rect.top };
    setMenuPos({ x: rect.right + 4, y: rect.top, flipBottomY: rect.bottom });
  }, []);
  const clampedMenuPos = useViewportClampedPosition(
    menuRef, menuPos?.x ?? 0, menuPos?.y ?? 0, POPUP_MENU.VIEWPORT_MARGIN, menuPos?.flipBottomY,
  );

  // "Can't zoom" hint — shown instead of zooming while the camera is locked to
  // a listener's first-person view (zoomToObjectById would have no effect).
  const [fpsHintAnchor, setFpsHintAnchor] = useState<{ left: number; centerY: number } | null>(null);
  useEffect(() => {
    if (!fpsHintAnchor) return;
    const close = () => setFpsHintAnchor(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [fpsHintAnchor]);
  // Leaving first-person view makes the hint moot.
  useEffect(() => {
    if (!isFirstPersonMode) setFpsHintAnchor(null);
  }, [isFirstPersonMode]);

  const handleZoomToEntity = useCallback(() => {
    if (!onZoomToEntity) return;
    if (isFirstPersonMode) {
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) setFpsHintAnchor({ left: rect.right, centerY: rect.top + rect.height / 2 });
      return;
    }
    onZoomToEntity();
  }, [onZoomToEntity, isFirstPersonMode]);

  const menuItems: Array<[string, () => void]> = [
    [isRecurring ? 'Interval settings' : 'Distribute evenly', () => onRequestDistribute(kebabAnchorRef.current)],
    ['Select all clips on track', onSelectAllClips],
    ['Clear clips', onClearClips],
    ['Reset track', onResetTrack],
    ...(onOpenSoundCard ? ([['Open sound card', onOpenSoundCard]] as Array<[string, () => void]>) : []),
    ['Zoom to entity', handleZoomToEntity],
    ['Clear entity links', onClearEntityLinks],
  ];

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
      onMouseEnter={onHoverTrack}
      onMouseLeave={onHoverTrackEnd}
    >
      {/* Frosted backdrop — lanes/clips scrolling horizontally behind the sticky
          head column are hidden behind the same glass treatment as the dock.
          Kept on its own layer (not a backdrop-filter on the root) so the kebab
          menu's position:fixed is not captured by a containing block. */}
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
          onDoubleClick={onZoomToEntity ? handleZoomToEntity : undefined}
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
        {canEdit && (
        <button
          ref={kebabRef}
          onClick={openMenu}
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
        {menuPos && (
          <div
            ref={menuRef}
            onMouseLeave={() => setMenuPos(null)}
            style={{
              position: 'fixed', left: `${clampedMenuPos?.x ?? menuPos.x}px`, top: `${clampedMenuPos?.y ?? menuPos.y}px`,
              opacity: clampedMenuPos ? 1 : 0, zIndex: 999999,
              backgroundColor: 'var(--background)', border: '1px solid var(--color-border-strong)',
              borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.5)', padding: '4px 0', width: '180px',
            }}
          >
            {menuItems.map(([label, action]) => (
              <div
                key={label}
                onClick={() => { action(); setMenuPos(null); }}
                style={{ padding: '6px 12px', cursor: 'pointer', fontSize: '11px', color: 'var(--foreground)', whiteSpace: 'nowrap' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-border)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {label}
              </div>
            ))}
          </div>
        )}
        {fpsHintAnchor && (
          <div
            className="bar-hint fps-hint"
            role="status"
            aria-live="polite"
            style={{
              left: fpsHintAnchor.left + DAW_FPS_ZOOM_HINT.GAP,
              top: fpsHintAnchor.centerY,
              width: DAW_FPS_ZOOM_HINT.WIDTH,
              zIndex: DAW_FPS_ZOOM_HINT.Z_INDEX,
            }}
          >
            <div className="bar-hint__body">
              <p className="bar-hint__title">{DAW_FPS_ZOOM_HINT.TITLE}</p>
              <p className="bar-hint__message">{DAW_FPS_ZOOM_HINT.MESSAGE}</p>
            </div>
            <button
              type="button"
              className="bar-hint__close"
              onClick={() => setFpsHintAnchor(null)}
              title={DAW_FPS_ZOOM_HINT.CLOSE_LABEL}
              aria-label={DAW_FPS_ZOOM_HINT.CLOSE_LABEL}
            >
              <Icon size="12px">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </Icon>
            </button>
          </div>
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
