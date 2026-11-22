'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Play, Sparkles } from 'lucide-react';
import { OptionalShortcutTooltip, ariaKeyShortcuts } from '@/components/ui/ShortcutTooltip';
import { ProgressLanes } from '@/components/ui/ProgressLanes';
import type { ProgressLane } from '@/types';
import type { ShortcutId } from '@/utils/constants';

/**
 * GenerateButton Component
 *
 * Minimal run / stop / progress control at the bottom of a Card. Status is
 * derived by the caller from existing store-driven state (isRunning / hasResult).
 *
 * - `idle`       → transparent row: small left-aligned label + Play icon fixed
 *                  on the right (a sparkle "magic AI" icon when `isAi` is set)
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
  /**
   * Marks the idle action as AI-driven — renders the sparkle "magic AI" icon
   * instead of the Play triangle (e.g. LLM analysis, TangoFlux generation).
   * The done-state continue action always keeps the Play icon (it navigates).
   */
  isAi?: boolean;
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
  /** Keyboard shortcut for the idle action — shown in a ShortcutTooltip instead of the native title. */
  shortcut?: ShortcutId;
  /** Parallel parts of the run; with two or more, clicking the status line (chevron after its text) shows one row each */
  lanes?: ProgressLane[] | null;
}

/** How long the disabled-click error message stays visible before fading back to the label */
const DISABLED_MSG_DURATION_MS = 2600;

export function GenerateButton({
  status,
  progress,
  statusText,
  label = 'Generate',
  isAi = false,
  disabled = false,
  disabledReason,
  onGenerate,
  onStop,
  doneLabel,
  onDoneAction,
  shortcut,
  lanes,
}: GenerateButtonProps) {
  // Disabled-click feedback: flash the reason in red, then return to the label.
  const [showDisabledMsg, setShowDisabledMsg] = useState(false);
  const [lanesOpen, setLanesOpen] = useState(false);
  const disabledMsgTimerRef = useRef<number | null>(null);
  const [doneHovered, setDoneHovered] = useState(false);

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

  // Done state renders the full primary action button (same as idle) when a
  // continue action exists — otherwise there is nothing to click and the caller
  // hides the whole bar. Always uses the same triangle icon as idle.
  if (status === 'done') {
    if (!doneLabel || !onDoneAction) return null;
    return (
      <button
        className="btn-primary"
        onClick={onDoneAction}
        title={doneLabel}
        aria-label={doneLabel}
        onMouseEnter={() => setDoneHovered(true)}
        onMouseLeave={() => setDoneHovered(false)}
        style={{
          backgroundColor: doneHovered
            ? 'color-mix(in srgb, var(--color-primary) 12%, var(--color-on-blue))'
            : 'var(--color-on-blue)',
          color: 'var(--color-primary)',
          border: 'none',
        }}
      >
        <span>{doneLabel}</span>
        <Play size={11} fill="currentColor" />
      </button>
    );
  }

  if (status === 'generating') {
    const clamped = Math.max(0, Math.min(progress || 0, 100));
    const hasStop = !!onStop;
    const hasLanes = !!lanes && lanes.length > 1;
    return (
      <div className="w-full">
        {/* Status line (with parallel parts, the whole line toggles them; the chevron ends the text) + stop square */}
        <div className="gen-status">
          {hasLanes ? (
            <button
              className={`gen-status-toggle${lanesOpen ? ' open' : ''}`}
              onClick={() => setLanesOpen((open) => !open)}
              aria-expanded={lanesOpen}
              title={lanesOpen ? 'Hide parallel parts' : `Show the ${lanes.length} parallel parts`}
            >
              <span className="gen-status-text">{statusText || 'Working…'}</span>
              <ChevronDown size={12} className="lanes-chevron" aria-hidden />
            </button>
          ) : (
            <span className="gen-status-text">{statusText || 'Working…'}</span>
          )}
          {hasStop && (
            <span className="gen-status-actions">
              <button className="stop" onClick={onStop} aria-label="Stop" title="Stop" />
            </span>
          )}
        </div>
        {/* Progress track / fill */}
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${clamped}%` }} />
        </div>
        {hasLanes && lanesOpen && <ProgressLanes lanes={lanes} />}
      </div>
    );
  }

  // idle
  if (!onGenerate) return null;
  const idleButton = (
    <button
      className="btn-primary"
      onClick={handleIdleClick}
      aria-disabled={disabled}
      disabled={disabled}
      title={shortcut ? undefined : (disabled ? (disabledReason || label) : label)}
      aria-label={disabled ? (disabledReason || label) : label}
      aria-keyshortcuts={ariaKeyShortcuts(shortcut)}
    >
      <span>{label}</span>
      {isAi ? (
        <Sparkles
          size={13}
          fill="currentColor"
          strokeWidth={1}
          style={{ width: 13, height: 13 }}
        />
      ) : (
        <Play size={11} fill="currentColor" />
      )}
    </button>
  );
  return (
    <div>
      {showDisabledMsg && (
        <div
          className="text-[10px] text-error text-center mb-1"
          style={{ animation: `message-flash ${DISABLED_MSG_DURATION_MS}ms ease-in-out forwards` }}
        >
          {disabledReason || 'Not available'}
        </div>
      )}
      <OptionalShortcutTooltip shortcut={shortcut} label={label}>{idleButton}</OptionalShortcutTooltip>
    </div>
  );
}
