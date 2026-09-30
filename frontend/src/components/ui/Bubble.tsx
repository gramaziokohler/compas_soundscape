"use client";

import { type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { SIMPLE_MODE } from "@/utils/constants";

export type BubbleStatus = "idle" | "queued" | "running" | "error";
/** Accent family: primary (scenes, simulations) or listener (the listener card color). */
export type BubbleTone = "primary" | "listener";

export interface BubbleProps {
  /** Accessible name and hover label. */
  label: string;
  /** Pictogram drawn in `currentColor` (see BubbleIcons). */
  icon: ReactNode;
  /** Diameter in px. */
  size?: number;
  /** Generated / simulated — primary border and icon. */
  ready?: boolean;
  /** In use (the scene playing / the active auralization / the listener in focus).
   *  Ready + selected = solid primary with an inverted icon. */
  selected?: boolean;
  status?: BubbleStatus;
  /** 0..1 progress ring, shown while `status` is running or queued. */
  progress?: number;
  /** Which side the hover label pops out on. */
  labelSide?: "left" | "right";
  /** Secondary line in the hover label (e.g. live status). */
  detail?: string;
  tone?: BubbleTone;
  onClick: () => void;
}

/**
 * Bubble Component
 *
 * Frosted circular button used by Simple mode for sound scenes, acoustic
 * simulations and listeners. One state system for all of them: pending
 * (frosted, muted icon), ready (primary border + icon), ready + selected
 * (solid primary, inverted icon); a progress ring while running.
 *
 * Usage:
 * ```tsx
 * <Bubble
 *   label="Office lunch"
 *   icon={<WaveformRing values={envelope} size={36} />}
 *   ready
 *   selected={isPlaying}
 *   onClick={() => handleClick(3)}
 * />
 * ```
 */
export function Bubble({
  label,
  icon,
  size = SIMPLE_MODE.BUBBLE_SIZE,
  ready = false,
  selected = false,
  status = "idle",
  progress = 0,
  labelSide = "right",
  detail,
  tone = "primary",
  onClick,
}: BubbleProps) {
  const ringSize = size + SIMPLE_MODE.RING_STROKE * 4;
  const radius = ringSize / 2 - SIMPLE_MODE.RING_STROKE;
  const circumference = 2 * Math.PI * radius;
  const showRing = status === "running" || status === "queued";

  const classes = [
    "bubble backdrop-blur-lg backdrop-saturate-150",
    tone !== "primary" && `bubble--${tone}`,
    ready && "bubble--ready",
    selected && "bubble--selected",
    status !== "idle" && `bubble--${status}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="bubble-wrap group" style={{ width: size, height: size }}>
      <button
        type="button"
        className={classes}
        style={{ width: size, height: size }}
        onClick={onClick}
        aria-label={label}
        aria-pressed={selected}
      >
        {showRing && (
          <svg
            className="bubble-ring"
            width={ringSize}
            height={ringSize}
            viewBox={`0 0 ${ringSize} ${ringSize}`}
            aria-hidden="true"
          >
            <circle className="bubble-ring__track" cx={ringSize / 2} cy={ringSize / 2} r={radius} strokeWidth={SIMPLE_MODE.RING_STROKE} />
            <circle
              className="bubble-ring__value"
              cx={ringSize / 2}
              cy={ringSize / 2}
              r={radius}
              strokeWidth={SIMPLE_MODE.RING_STROKE}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - Math.max(0, Math.min(1, progress)))}
              strokeLinecap="round"
            />
          </svg>
        )}
        {icon}
      </button>
      <span
        className={`bubble-label sidebar-toggle-label backdrop-blur-lg backdrop-saturate-150 bubble-label--${labelSide}`}
        aria-hidden="true"
      >
        <span className="bubble-label__title">{label}</span>
        {detail && <span className="bubble-label__detail">{detail}</span>}
      </span>
    </div>
  );
}

export interface BubbleAddButtonProps {
  label: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  size?: number;
  labelSide?: "left" | "right";
  tone?: BubbleTone;
}

/**
 * BubbleAddButton Component
 *
 * The frosted dashed "+" that closes a bubble column (add scene / simulation / listener).
 *
 * Usage:
 * ```tsx
 * <BubbleAddButton label="New sound scene" active={composerOpen} onClick={toggleComposer} />
 * ```
 */
export function BubbleAddButton({ label, onClick, active = false, size = SIMPLE_MODE.BUBBLE_SIZE, labelSide = "right", tone = "primary" }: BubbleAddButtonProps) {
  return (
    <div className="bubble-wrap group" style={{ width: size, height: size }}>
      <button
        type="button"
        className={`bubble bubble--add backdrop-blur-lg backdrop-saturate-150 ${tone !== "primary" ? `bubble--${tone}` : ""} ${active ? "bubble--selected" : ""}`}
        style={{ width: size, height: size }}
        onClick={onClick}
        aria-label={label}
        aria-expanded={active}
      >
        <svg width={size * 0.4} height={size * 0.4} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
        </svg>
      </button>
      <span
        className={`bubble-label sidebar-toggle-label backdrop-blur-lg backdrop-saturate-150 bubble-label--${labelSide}`}
        aria-hidden="true"
      >
        <span className="bubble-label__title">{label}</span>
      </span>
    </div>
  );
}

export interface BubbleExitButtonProps {
  /** Hover label, e.g. "Leave FPS view". */
  label: string;
  onClick: () => void;
  size?: number;
  labelSide?: "left" | "right";
}

/**
 * BubbleExitButton Component
 *
 * Small warning-colored circle that sits beside an active bubble and leaves the
 * mode it put the viewer in (e.g. a listener's first-person view).
 *
 * Usage:
 * ```tsx
 * <BubbleExitButton label="Leave FPS view" labelSide="left" onClick={exitFps} />
 * ```
 */
export function BubbleExitButton({ label, onClick, size = SIMPLE_MODE.EXIT_BUTTON_SIZE, labelSide = "left" }: BubbleExitButtonProps) {
  return (
    <div className="bubble-wrap" style={{ width: size, height: size }}>
      <button
        type="button"
        className="bubble bubble--exit backdrop-blur-lg backdrop-saturate-150"
        style={{ width: size, height: size }}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        aria-label={label}
      >
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <path d="M16 17l5-5-5-5" />
          <path d="M21 12H9" />
        </svg>
      </button>
      <span
        className={`bubble-label sidebar-toggle-label backdrop-blur-lg backdrop-saturate-150 bubble-label--${labelSide}`}
        aria-hidden="true"
      >
        <span className="bubble-label__title">{label}</span>
      </span>
    </div>
  );
}

export interface BubbleHeadingProps {
  children: ReactNode;
  /** Fixed-position placement (left/right/top/bottom). */
  style: CSSProperties;
}

/**
 * BubbleHeading Component
 *
 * Column title ("Soundscapes", "Acoustics", "Listeners") in inverting
 * (difference-blend) text — readable over any 3D backdrop with no background.
 * Rendered as its own fixed element: nesting it in a stacking context (e.g.
 * the bubble column) would make it blend against nothing.
 *
 * Usage:
 * ```tsx
 * <BubbleHeading style={{ left: 16, top: 16 }}>Soundscapes</BubbleHeading>
 * ```
 */
export function BubbleHeading({ children, style }: BubbleHeadingProps) {
  return (
    <div className="bubble-heading" style={{ zIndex: SIMPLE_MODE.Z_INDEX, ...style }}>
      {children}
    </div>
  );
}
