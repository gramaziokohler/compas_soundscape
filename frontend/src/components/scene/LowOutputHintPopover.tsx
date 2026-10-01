'use client';

import { Icon } from '@/components/ui/Icon';
import { useLowOutputHints } from '@/hooks/useLowOutputHints';
import type { AudioOrchestrator } from '@/lib/audio/AudioOrchestrator';

interface LowOutputHintPopoverProps {
  audioOrchestrator: AudioOrchestrator | null;
  isPlaying: boolean;
  timelineOpen: boolean;
  onOpenTimeline: () => void;
}

/**
 * Helper popover that rises above the play button when the scene plays too
 * quietly, explains the likely cause and offers a one-click fix.
 * Must be rendered inside a `position: relative` container (the bar's
 * playback group).
 *
 * Usage:
 * ```tsx
 * <LowOutputHintPopover audioOrchestrator={orch} isPlaying={isPlaying}
 *   timelineOpen={showTimeline} onOpenTimeline={onToggleTimeline} />
 * ```
 */
export function LowOutputHintPopover(props: LowOutputHintPopoverProps) {
  const { hint, applyAction, dismiss } = useLowOutputHints(props);
  if (!hint) return null;

  return (
    <div className="bar-hint" role="status" aria-live="polite">
      <span className="bar-hint__icon" aria-hidden="true">
        <Icon size="14px">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </Icon>
      </span>
      <div className="bar-hint__body">
        <p className="bar-hint__title">Hard to hear?</p>
        <p className="bar-hint__message">{hint.message}</p>
        {hint.action && (
          <button type="button" className="bar-hint__action" onClick={applyAction}>
            {hint.action.label}
          </button>
        )}
      </div>
      <button type="button" className="bar-hint__close" onClick={dismiss} title="Don't show this again" aria-label="Dismiss hint">
        <Icon size="12px">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </Icon>
      </button>
    </div>
  );
}
