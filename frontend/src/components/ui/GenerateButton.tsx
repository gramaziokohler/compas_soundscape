'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Square, Check } from 'lucide-react';

/**
 * GenerateButton Component
 *
 * Minimal run / stop / progress control at the bottom of a Card. Status is
 * derived by the caller from existing store-driven state (isRunning / hasResult).
 *
 * - `idle`       → transparent row: small left-aligned label + Play icon fixed
 *                  on the right
 * - `generating` → tiny polling status text above a thin progress track, with
 *                  the Stop icon superposed in the same right-hand spot as Play
 *                  (same color, hover animation)
 * - `done`       → continue-action row (Check icon); renders null when no
 *                  continue action exists (nothing left to generate)
 *
 * When disabled, clicking the idle button flashes `disabledReason` in red
 * (same font, fading) instead of running the action, then returns to the label.
 *
 * Usage:
 * ```tsx
 * <GenerateButton
 *   status={status}
 *   progress={progress}
 *   label="Generate Sound"
 *   onGenerate={handleGenerate}
 *   onStop={handleStop}
 * />
 * ```
 */

export type GenerateStatus = 'idle' | 'generating' | 'done';

export interface GenerateButtonProps {
  /** Current card state — derived from isRunning / hasResult by the caller */
  status: GenerateStatus;
  /** Progress percentage (0-100), shown only while generating */
  progress: number;
  /** Polling/status info shown in tiny text above the progress bar while generating */
  statusText?: string;
  /** Label for the idle-state action button (default: "Generate") */
  label?: string;
  /** Disables the idle-state action button */
  disabled?: boolean;
  /** Error message flashed in red when a disabled button is clicked */
  disabledReason?: string;
  /** Click handler for the idle-state action button */
  onGenerate?: () => void;
  /** Click handler for the stop button while generating (omitting hides the stop button) */
  onStop?: () => void;
  /** Label for the done-state continue action (e.g. "Next: Usage") */
  doneLabel?: string;
  /** Click handler for the done-state continue action */
  onDoneAction?: () => void;
}

/** How long the disabled-click error message stays visible before fading back to the label */
const DISABLED_MSG_DURATION_MS = 2600;

export function GenerateButton({
  status,
  progress,
  statusText,
  label = 'Generate',
  disabled = false,
  disabledReason,
  onGenerate,
  onStop,
  doneLabel,
  onDoneAction,
}: GenerateButtonProps) {
  // Disabled-click feedback: flash the reason in red, then return to the label.
  const [showDisabledMsg, setShowDisabledMsg] = useState(false);
  const disabledMsgTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (disabledMsgTimerRef.current) window.clearTimeout(disabledMsgTimerRef.current);
    };
  }, []);

  const handleIdleClick = () => {
    if (disabled) {
      setShowDisabledMsg(true);
      if (disabledMsgTimerRef.current) window.clearTimeout(disabledMsgTimerRef.current);
      disabledMsgTimerRef.current = window.setTimeout(
        () => setShowDisabledMsg(false),
        DISABLED_MSG_DURATION_MS
      );
      return;
    }
    onGenerate?.();
  };

  // Run and stop icons share the same color and the same right-hand spot.
  const iconColor = 'var(--color-primary)';

  // Done state renders a continue action only when one exists — otherwise there
  // is nothing to generate and the caller hides the whole bar.
  if (status === 'done') {
    if (!doneLabel || !onDoneAction) return null;
    return (
      <button
        onClick={onDoneAction}
        title={doneLabel}
        aria-label={doneLabel}
        className="group w-full flex items-end gap-2 py-0.5 px-1 text-left cursor-pointer"
      >
        <span className="flex-1 text-[11px] font-medium truncate items-center justify-center text-secondary group-hover:scale-102">
          {doneLabel}
        </span>
        {/* Check icon — same right-hand spot as run/stop */}
        <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-150 group-hover:bg-secondary-light group-hover:scale-120">
          <Check size={14} strokeWidth={2.5} color={iconColor} />
        </span>
      </button>
    );
  }

  if (status === 'generating') {
    const clamped = Math.max(0, Math.min(progress || 0, 100));
    return (
      <div className="w-full flex items-end gap-2 py-0.5 px-1 ">
        <div className="flex-1 min-w-0">
          {/* Tiny polling/status info above the progress track */}
          <div className="text-[9px] leading-tight text-secondary-hover truncate mb-1">
            {statusText || 'Working…'}
          </div>
          <div
            className="relative h-1 rounded-full overflow-hidden"
            style={{ backgroundColor: 'var(--color-secondary-lighter)' }}
          >
            <div
              className="absolute inset-y-0 left-0 transition-all duration-300"
              style={{ width: `${clamped}%`, backgroundColor: iconColor }}
            />
          </div>
        </div>
        {/* Stop icon — superposed on the run icon spot (same color, hover animation) */}
        <button
          onClick={onStop}
          title="Stop"
          aria-label="Stop"
          className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-150 hover:bg-secondary-light hover:scale-120 cursor-pointer"
        >
          <Square size={14} fill={iconColor} color={iconColor} />
        </button>
      </div>
    );
  }

  // idle
  if (!onGenerate) return null;
  return (
    <button
      onClick={handleIdleClick}
      aria-disabled={disabled}
      title={disabled ? (disabledReason || label) : label}
      aria-label={disabled ? (disabledReason || label) : label}
      className={`group w-full flex items-end gap-2 py-0.5 px-1 border-t-2 border-primary-hover/70 text-left ${
        disabled ? 'cursor-not-allowed' : 'cursor-pointer'
      }`}
    >
      {showDisabledMsg ? (
        <span
          key="err"
          className="flex-1 text-[11px] font-medium truncate items-center justify-center text-error"
          style={{ animation: `message-flash ${DISABLED_MSG_DURATION_MS}ms ease-in-out forwards` }}
        >
          {disabledReason || 'Not available'}
        </span>
      ) : (
        <span
          key="label"
          className={`flex-1 text-[11px] font-medium truncate items-center justify-center group-hover:scale-102 ${
            disabled ? 'text-secondary-hover' : 'text-secondary'
          }`}
        >
          {label}
        </span>
      )}
      {/* Run icon — fixed on the right, rotating hover animation with delays */}
      <span
        className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-150 group-hover:bg-secondary-light group-hover:animate-generate-spin"
        style={{ opacity: disabled ? 0.4 : 1 }}
      >
        <Play size={14} fill={iconColor} color={iconColor} />
      </span>
    </button>
  );
}
