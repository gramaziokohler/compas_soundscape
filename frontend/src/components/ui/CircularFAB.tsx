'use client';

export interface CircularFABProps {
  label: string;
  onClick: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export function CircularFAB({ label, onClick, isLoading, disabled, disabledReason }: CircularFABProps) {
  const isDisabled = disabled || isLoading;
  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      title={isLoading ? 'Working…' : isDisabled ? (disabledReason || label) : label}
      aria-label={isLoading ? 'Working…' : isDisabled ? (disabledReason || label) : label}
      style={{
        position: 'absolute',
        right: '-14px',
        top: '50%',
        transform: 'translateY(-50%)',
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        backgroundColor: 'var(--color-secondary)',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: isDisabled ? 'none' : '0 0px 8px var(--color-secondary)',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        border: 'none',
        flexShrink: 0,
        opacity: isDisabled && !isLoading ? 0.4 : isLoading ? 0.7 : 1,
        transition: 'transform 150ms ease, box-shadow 150ms ease, opacity 150ms ease',
      }}
      onMouseEnter={(e) => {
        if (!isDisabled) (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-50%) scale(1.12)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-50%)';
      }}
    >
      {isLoading ? (
        <span
          className="inline-block w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin"
          aria-hidden="true"
        />
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 7h8M7.5 3.5L11 7l-3.5 3.5" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
