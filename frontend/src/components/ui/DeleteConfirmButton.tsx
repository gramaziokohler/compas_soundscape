"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SIMPLE_MODE } from "@/utils/constants";

export interface DeleteConfirmButtonProps {
  /** Accessible name and tooltip, e.g. "Remove scene". */
  title: string;
  /** Question shown in the confirmation, e.g. "Remove this scene and its sounds?". */
  message: string;
  onConfirm: () => void;
  confirmLabel?: string;
  /** Disables the button and explains why in its tooltip. */
  disabledReason?: string;
  /** Recolors the icon for legibility on a solid-blue generated card. */
  onBlueBackground?: boolean;
}

/**
 * Fixed-position placement of the confirmation: right-aligned with the button,
 * above it — or below when there is not enough room above (button near the top).
 */
function placePopover(anchor: DOMRect, popoverHeight: number): CSSProperties {
  const { DELETE_CONFIRM_GAP: gap, DELETE_CONFIRM_MARGIN: margin, DELETE_CONFIRM_WIDTH: width } = SIMPLE_MODE;
  const left = Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin));
  const fitsAbove = anchor.top - gap - popoverHeight >= margin;
  const top = fitsAbove ? anchor.top - gap - popoverHeight : anchor.bottom + gap;
  return { left, top, width, zIndex: SIMPLE_MODE.DELETE_CONFIRM_Z_INDEX };
}

/**
 * DeleteConfirmButton Component
 *
 * Trash button for the bottom-right corner of a Simple-mode card / panel. A
 * click opens a danger confirmation stacked vertically right above it (below
 * when the button sits near the top of the screen). Rendered in a portal so a
 * scrolling / clipping card never crops it. Outside click, Escape, scroll or
 * resize cancels.
 *
 * Usage:
 * ```tsx
 * <DeleteConfirmButton
 *   title="Remove scene"
 *   message="Remove this scene and its sounds?"
 *   onConfirm={() => removeScene(index)}
 * />
 * ```
 */
export function DeleteConfirmButton({
  title,
  message,
  onConfirm,
  confirmLabel = "Remove",
  disabledReason,
  onBlueBackground = false,
}: DeleteConfirmButtonProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Measure the rendered popover, then place it (hidden until placed — no flash).
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return;
    }
    const anchor = buttonRef.current?.getBoundingClientRect();
    const height = popoverRef.current?.offsetHeight ?? 0;
    if (anchor) setPlacement(placePopover(anchor, height));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!buttonRef.current?.contains(target) && !popoverRef.current?.contains(target)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // Scrolling inside the popover itself must not close it.
    const onScroll = (e: Event) => {
      if (!popoverRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div className="delete-confirm" onClick={(e) => e.stopPropagation()}>
      {open && createPortal(
        <div
          ref={popoverRef}
          className="delete-confirm__popover"
          style={placement ?? { left: 0, top: 0, width: SIMPLE_MODE.DELETE_CONFIRM_WIDTH, visibility: "hidden" }}
          role="dialog"
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <ConfirmDialog
            message={message}
            variant="danger"
            confirmLabel={confirmLabel}
            solidBackground
            stacked
            onConfirm={() => {
              setOpen(false);
              onConfirm();
            }}
            onCancel={() => setOpen(false)}
          />
        </div>,
        document.body,
      )}
      <button
        ref={buttonRef}
        type="button"
        className={`delete-confirm__btn${onBlueBackground ? " delete-confirm__btn--on-blue" : ""}${open ? " delete-confirm__btn--open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        disabled={!!disabledReason}
        title={disabledReason ?? title}
        aria-label={title}
        aria-expanded={open}
      >
        <Trash2 size={12} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}
