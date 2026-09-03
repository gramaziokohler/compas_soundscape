"use client";

/**
 * CardSelect Component
 *
 * Custom dropdown matching the card design system (`.select-trigger` /
 * `.select-menu` / `.select-opt` in the Reference). A button-like trigger with a
 * rotating chevron reveals a floating option menu rendered through a portal to
 * `<body>`, so it is never clipped by the card's `overflow` scroll container and
 * always fits the viewport (opens upward when there is no room below). Replaces
 * the native `<select>` everywhere so all dropdowns share one visual language.
 * When there are `CARD_SELECT_INLINE_MAX_OPTIONS` or fewer choices, renders
 * `TextSelect` instead (horizontal plain-text labels).
 *
 * Usage:
 * ```tsx
 * <CardSelect
 *   value={mode}
 *   onChange={setMode}
 *   options={[
 *     { value: 'anechoic', label: 'No Acoustics' },
 *     { value: 'resonance', label: 'ShoeBox Acoustics' },
 *   ]}
 * />
 * ```
 */
import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CARD_SELECT_INLINE_MAX_OPTIONS } from "@/utils/constants";
import { TextSelect } from "@/components/ui/TextSelect";

export interface CardSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Native tooltip shown on hover (trigger uses the selected option's title). */
  title?: string;
  /** Inline style for this option row (e.g. material-absorption color coding). */
  style?: CSSProperties;
}

export interface CardSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CardSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Compact trigger (smaller padding) for inline rows like the method selector. */
  compact?: boolean;
  /** Inline style for the trigger button (e.g. material-absorption color coding). */
  triggerStyle?: CSSProperties;
  /** Max height of the option menu before it scrolls. Default 240px. */
  menuMaxHeight?: number;
  /** Always render the floating menu, even when there are few options. */
  forceMenu?: boolean;
}

const MENU_MAX_HEIGHT = 240;
const MENU_GAP = 4;
/** Below this, opening downward would leave too few options visible — fall back to upward. */
const MIN_USABLE_MENU_HEIGHT = 120;

export function CardSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled = false,
  className = "",
  compact = false,
  triggerStyle,
  menuMaxHeight = MENU_MAX_HEIGHT,
  forceMenu = false,
}: CardSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [menuHeight, setMenuHeight] = useState(menuMaxHeight);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!isOpen) return;
    // Clicks inside the trigger root or inside the portal'd menu must NOT close it.
    const insideMenu = (node: Node | null) => !!menuRef.current?.contains(node);
    const onDown = (e: MouseEvent) => {
      if (insideMenu(e.target as Node)) return;
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    // Only close when a scroll happens OUTSIDE the menu — scrolling its own
    // scrollable option list must not dismiss it.
    const onScroll = (e: Event) => {
      if (insideMenu(e.target as Node)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [isOpen]);

  const handleTriggerClick = () => {
    if (disabled) return;
    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const spaceBelow = vh - rect.bottom - MENU_GAP;
      const spaceAbove = rect.top - MENU_GAP;
      // The menu is a fixed-position portal, so it is never clipped by a
      // parent panel's overflow — it can freely extend past the panel's own
      // edge. Prefer opening downward (below the trigger) even when that
      // means overflowing outside a small enclosing panel; only flip upward
      // when there is truly too little room below AND more room above.
      const wantsUpward = spaceBelow < MIN_USABLE_MENU_HEIGHT && spaceAbove > spaceBelow;
      const left = Math.min(rect.left, vw - 8);
      const height = wantsUpward
        ? Math.min(menuMaxHeight, spaceAbove)
        : Math.min(menuMaxHeight, Math.max(spaceBelow, MIN_USABLE_MENU_HEIGHT));
      setOpenUpward(wantsUpward);
      setMenuHeight(height);
      setMenuPos({
        left,
        top: wantsUpward ? Math.max(4, rect.top - height - MENU_GAP) : rect.bottom + MENU_GAP,
        width: rect.width,
      });
    }
    setIsOpen((v) => !v);
  };

  if (!forceMenu && options.length <= CARD_SELECT_INLINE_MAX_OPTIONS) {
    return (
      <TextSelect
        value={value}
        onChange={onChange}
        options={options}
        disabled={disabled}
        className={className}
        compact={compact}
      />
    );
  }

  return (
    <div ref={rootRef} className={`select ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={handleTriggerClick}
        className={`select-trigger ${isOpen ? "open" : ""} ${compact ? "compact" : ""}`}
        style={triggerStyle}
        title={selected?.title}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {isOpen && menuPos &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            className={`select-menu open ${openUpward ? "upward" : ""}`}
            style={{
              position: "fixed",
              left: menuPos.left,
              top: menuPos.top,
              width: menuPos.width,
              maxHeight: `${menuHeight}px`,
              overflowY: "auto",
              zIndex: 99999,
            }}
          >
            {options.map((opt) => {
              const active = opt.value === value;
              return (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={active}
                  className={`select-opt ${active ? "active" : ""} ${opt.disabled ? "opacity-40 cursor-not-allowed" : ""}`}
                  style={opt.style}
                  title={opt.title}
                  onClick={() => {
                    if (opt.disabled) return;
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                >
                  {opt.label}
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}

export default CardSelect;