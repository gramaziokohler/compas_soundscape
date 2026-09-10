'use client';

import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { DAW, DEFAULT_DBFS } from '@/utils/constants';
import type { TimelineSound } from '@/types/audio';

interface DAWTrackHeadProps {
  sound: TimelineSound;
  displayName: string;
  groupLabel: string;
  clipCount: number;
  trackHeight: number;
  isMuted: boolean;
  isSoloed: boolean;
  volumeDbfs: number;
  onMute: () => void;
  onSolo: () => void;
  onVolumeChange: (dbfs: number) => void;
  onSelectSoundCard?: () => void;
  onDoubleClickSoundCard?: () => void;
  /** Open the transient "Interval settings" popover, anchored so its bottom-left
   * corner touches the kebab button's top-right corner (anchor = kebab top-right). */
  onRequestDistribute: (anchor: { x: number; y: number }) => void;
  onSelectAllClips: () => void;
  onClearClips: () => void;
  onResetTrack: () => void;
  onZoomToLinkedEntity: () => void;
  onClearEntityLinks: () => void;
  onHoverTrack?: () => void;
  onHoverTrackEnd?: () => void;
}

function DAWTrackHeadImpl({
  sound,
  displayName,
  groupLabel,
  clipCount,
  trackHeight,
  isMuted,
  isSoloed,
  volumeDbfs,
  onMute,
  onSolo,
  onVolumeChange,
  onSelectSoundCard,
  onDoubleClickSoundCard,
  onRequestDistribute,
  onSelectAllClips,
  onClearClips,
  onResetTrack,
  onZoomToLinkedEntity,
  onClearEntityLinks,
  onHoverTrack,
  onHoverTrackEnd,
}: DAWTrackHeadProps) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const kebabRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const kebabAnchorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

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
    setMenuPos({ x: rect.right + 4, y: rect.top });
  }, []);

  const menuItems: Array<[string, () => void]> = [
    ['Distribute evenly', () => onRequestDistribute(kebabAnchorRef.current)],
    ['Select all clips on track', onSelectAllClips],
    ['Clear clips', onClearClips],
    ['Reset track', onResetTrack],
    ...(onSelectSoundCard ? ([['Open sound card', onSelectSoundCard]] as Array<[string, () => void]>) : []),
    ['Zoom to linked entity', onZoomToLinkedEntity],
    ['Clear entity links', onClearEntityLinks],
  ];

  const showSubLabel = trackHeight >= DAW.TRACK_HEIGHT_SUBLABEL_MIN;

  return (
    <div
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
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseEnter={onHoverTrack}
      onMouseLeave={onHoverTrackEnd}
    >
      {/* Row 1: badge, name, kebab */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--card-space-xs)' }}>
        <span
          style={{
            display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%',
            backgroundColor: sound.color, flexShrink: 0,
          }}
        />
        <span
          title={displayName}
          onClick={onSelectSoundCard}
          onDoubleClick={onDoubleClickSoundCard}
          style={{
            fontSize: '10px', fontWeight: 600, color: 'var(--foreground)', flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            cursor: onSelectSoundCard ? 'pointer' : 'default', lineHeight: 1.2,
          }}
        >
          {displayName}
        </span>
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
        {menuPos && (
          <div
            ref={menuRef}
            onMouseLeave={() => setMenuPos(null)}
            style={{
              position: 'fixed', left: `${menuPos.x}px`, top: `${menuPos.y}px`, zIndex: 999999,
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
            backgroundColor: isMuted ? 'var(--color-warning)' : 'var(--color-secondary-light)',
            color: isMuted ? '#000' : 'var(--foreground)', fontWeight: 600, lineHeight: 1.5, flexShrink: 0,
          }}
        >
          M
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onSolo(); }}
          title={isSoloed ? 'Unsolo' : 'Solo'}
          style={{
            fontSize: '8px', padding: '1px 4px', borderRadius: '2px', border: 'none', cursor: 'pointer',
            backgroundColor: isSoloed ? 'var(--color-primary)' : 'var(--color-secondary-light)',
            color: isSoloed ? 'var(--color-on-blue)' : 'var(--foreground)', fontWeight: 600, lineHeight: 1.5, flexShrink: 0,
          }}
        >
          S
        </button>
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
      </div>
    </div>
  );
}

export const DAWTrackHead = memo(DAWTrackHeadImpl);
