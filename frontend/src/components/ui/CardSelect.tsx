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
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CARD_SELECT_INLINE_MAX_OPTIONS } from "@/utils/constants";
import { TextSelect } from "@/components/ui/TextSelect";

export interface CardSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  title?: string;
  style?: CSSProperties;
  /** Small filled circle shown at the left of the option (and trigger when selected). */
  badgeColor?: string;
}

export interface CardSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: CardSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
  triggerStyle?: CSSProperties;
  menuMaxHeight?: number;
  forceMenu?: boolean;
  /** Shrink trigger to selected label width. Pair with `alignMenu="right"` in tight rows. */
  fitContent?: boolean;
  alignMenu?: "left" | "right";
  menuHeader?: ReactNode;
  onOpenChange?: (open: boolean) => void;
  onOptionMouseEnter?: (option: CardSelectOption, e: React.MouseEvent<HTMLDivElement>) => void;
  onOptionMouseLeave?: () => void;
  onTriggerMouseEnter?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onTriggerMouseLeave?: () => void;
  /** Max width of the trigger; label truncates with ellipsis when exceeded. */
  triggerMaxWidth?: number | string;
  /** Max width of the dropdown menu. */
  menuMaxWidth?: number | string;
  /**
   * `trigger` — menu matches trigger width (default for full-width selects).
   * `content` — menu sizes to the longest option (independent of trigger width).
   */
  menuWidth?: "trigger" | "content";
  /** Badge color on the trigger when a value is selected (overrides option badge). */
  triggerBadgeColor?: string;
}

const MENU_MAX_HEIGHT = 240;
const MENU_GAP = 4;
const MIN_USABLE_MENU_HEIGHT = 120;

function SelectLabel({
  label,
  badgeColor,
  truncate = false,
}: {
  label: string;
  badgeColor?: string;
  truncate?: boolean;
}) {
  return (
    <span className={`select-trigger-label ${truncate ? "min-w-0" : ""}`}>
      {badgeColor && (
        <span className="select-opt-badge" style={{ backgroundColor: badgeColor }} aria-hidden />
      )}
      <span className={truncate ? "truncate" : "whitespace-nowrap"}>{label}</span>
    </span>
  );
}

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
  fitContent = false,
  alignMenu = "left",
  menuHeader,
  onOpenChange,
  onOptionMouseEnter,
  onOptionMouseLeave,
  onTriggerMouseEnter,
  onTriggerMouseLeave,
  triggerMaxWidth,
  menuMaxWidth,
  menuWidth = "trigger",
  triggerBadgeColor,
}: CardSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [menuPos, setMenuPos] = useState<{
    left: number;
    top: number;
    transform?: string;
    triggerWidth?: number;
  } | null>(null);
  const [menuHeight, setMenuHeight] = useState(menuMaxHeight);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);
  const resolvedMenuWidth = menuWidth === "content" || fitContent ? "content" : "trigger";

  const setOpen = (open: boolean) => {
    setIsOpen(open);
    onOpenChange?.(open);
  };

  useEffect(() => {
    if (!isOpen) return;
    const insideMenu = (node: Node | null) => !!menuRef.current?.contains(node);
    const onDown = (e: MouseEvent) => {
      if (insideMenu(e.target as Node)) return;
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (insideMenu(e.target as Node)) return;
      setOpen(false);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleTriggerClick = () => {
    if (disabled) return;
    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const spaceBelow = vh - rect.bottom - MENU_GAP;
      const spaceAbove = rect.top - MENU_GAP;
      const wantsUpward = spaceBelow < MIN_USABLE_MENU_HEIGHT && spaceAbove > spaceBelow;
      const height = wantsUpward
        ? Math.min(menuMaxHeight, spaceAbove)
        : Math.min(menuMaxHeight, Math.max(spaceBelow, MIN_USABLE_MENU_HEIGHT));
      const top = wantsUpward
        ? Math.max(4, rect.top - height - MENU_GAP)
        : rect.bottom + MENU_GAP;

      setOpenUpward(wantsUpward);
      setMenuHeight(height);

      if (alignMenu === "right") {
        setMenuPos({
          left: rect.right,
          top,
          transform: "translateX(-100%)",
          triggerWidth: rect.width,
        });
      } else {
        setMenuPos({
          left: Math.min(rect.left, vw - 8),
          top,
          triggerWidth: rect.width,
        });
      }
    }
    setOpen(!isOpen);
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

  const rootClass = [
    "select",
    fitContent ? "fit-content" : "",
    fitContent && alignMenu === "right" ? "fit-content-right" : "",
    className,
  ].filter(Boolean).join(" ");

  const triggerClass = [
    "select-trigger",
    isOpen ? "open" : "",
    compact ? "compact" : "",
    fitContent ? "fit-content" : "",
  ].filter(Boolean).join(" ");

  const resolvedTriggerBadge = triggerBadgeColor ?? selected?.badgeColor;
  const displayLabel = selected ? selected.label : placeholder;

  const mergedTriggerStyle: CSSProperties = {
    ...triggerStyle,
    ...(triggerMaxWidth !== undefined ? { maxWidth: triggerMaxWidth } : {}),
  };

  const menuStyle: CSSProperties = {
    position: "fixed",
    left: menuPos?.left,
    top: menuPos?.top,
    transform: menuPos?.transform,
    width: resolvedMenuWidth === "content" ? "max-content" : menuPos?.triggerWidth,
    minWidth: resolvedMenuWidth === "content" ? menuPos?.triggerWidth : undefined,
    maxWidth: menuMaxWidth,
    maxHeight: `${menuHeight}px`,
    overflowY: "auto",
    zIndex: 99999,
  };

  return (
    <div ref={rootRef} className={rootClass}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={handleTriggerClick}
        onMouseEnter={onTriggerMouseEnter}
        onMouseLeave={onTriggerMouseLeave}
        className={triggerClass}
        style={mergedTriggerStyle}
        title={selected?.title ?? displayLabel}
      >
        <SelectLabel
          label={displayLabel}
          badgeColor={resolvedTriggerBadge}
          truncate={!!triggerMaxWidth || !fitContent}
        />
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
            className={`select-menu open ${openUpward ? "upward" : ""} ${compact ? "compact" : ""}`}
            style={menuStyle}
          >
            {menuHeader && (
              <div className="p-1 border-b border-secondary-light mb-0.5" onClick={(e) => e.stopPropagation()}>
                {menuHeader}
              </div>
            )}
            {options.map((opt) => {
              const active = opt.value === value;
              const hasBadge = !!opt.badgeColor;
              return (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={active}
                  className={[
                    "select-opt",
                    active ? "active" : "",
                    compact ? "compact" : "",
                    hasBadge ? "has-badge" : "",
                    opt.disabled ? "opacity-40 cursor-not-allowed" : "",
                  ].filter(Boolean).join(" ")}
                  style={opt.style}
                  title={opt.title ?? opt.label}
                  onMouseEnter={(e) => onOptionMouseEnter?.(opt, e)}
                  onMouseLeave={onOptionMouseLeave}
                  onClick={() => {
                    if (opt.disabled) return;
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <SelectLabel label={opt.label} badgeColor={opt.badgeColor} truncate />
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
