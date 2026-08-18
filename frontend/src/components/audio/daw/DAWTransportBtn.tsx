'use client';

/**
 * Shared circular transport button used by DAWTimeline and DAWMiniTransport.
 * Sizes and chrome must stay identical in both places.
 *
 * Usage:
 * ```tsx
 * <DAWTransportBtn onClick={onPlay} title="Play">
 *   <DAWPlayIcon />
 * </DAWTransportBtn>
 * ```
 */
export function DAWTransportBtn({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        border: active ? '1.5px solid var(--color-primary)' : '1.5px solid rgba(255,255,255,0.2)',
        backgroundColor: active ? 'var(--color-primary)' : 'rgba(255,255,255,0.07)',
        color: active ? '#fff' : 'var(--foreground)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        flexShrink: 0,
        transition: 'background-color 0.1s, border-color 0.1s',
      }}
    >
      {children}
    </button>
  );
}

export function DAWPlayIcon() {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" style={{ transform: 'translateX(1px)' }} aria-hidden="true">
      <path d="M1 1 L9 6 L1 11 Z" fill="currentColor" />
    </svg>
  );
}

export function DAWPauseIcon() {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
      <rect x="0.5" y="1" width="3" height="10" rx="1" fill="currentColor" />
      <rect x="6.5" y="1" width="3" height="10" rx="1" fill="currentColor" />
    </svg>
  );
}

export function DAWStopIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" />
    </svg>
  );
}
