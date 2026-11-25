"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { clampToViewport, flipAboveIfOverflow, getViewport } from "@/utils/scale";
import { NESTED_MENU } from "@/utils/constants";

export type NestedMenuItem =
  /** `title` (submenu / radio) is shown as the row's native hover text. */
  | { kind: "submenu"; key: string; label: string; hint?: string; title?: string; items: NestedMenuItem[] }
  | { kind: "radio"; key: string; label: string; title?: string; checked: boolean; onSelect: () => void }
  | { kind: "toggle"; key: string; label: string; checked: boolean; onChange: (checked: boolean) => void }
  | {
      kind: "stepper";
      key: string;
      label: string;
      value: number;
      min: number;
      max: number;
      onChange: (value: number) => void;
    }
  | {
      /** Shows `value` like a submenu hint; clicking the row swaps in a text box (Enter / OK commits). */
      kind: "text";
      key: string;
      label: string;
      value: string;
      placeholder?: string;
      onCommit: (value: string) => void;
    }
  | {
      kind: "action";
      key: string;
      label: string;
      hint?: string;
      title?: string;
      onSelect: () => void;
      keepOpen?: boolean;
      /** Destructive action (clear / delete / reset): error-tinted label. */
      danger?: boolean;
      disabled?: boolean;
    }
  /** Static, non-interactive heading (muted); `mono` for code-like text. */
  | { kind: "label"; key: string; label: string; title?: string; mono?: boolean }
  /** Free-form content (sliders, ...). Keys pressed inside it do not reach outer handlers. */
  | { kind: "custom"; key: string; content: ReactNode }
  | { kind: "separator"; key: string };

export interface NestedMenuProps {
  /** Viewport point the root panel opens at (top-left corner, clamped into the viewport). */
  x: number;
  y: number;
  items: NestedMenuItem[];
  onClose: () => void;
  /** Opened below an anchor (kebab): near the screen bottom it flips above, its
   * bottom edge landing at `flipBottomY`, instead of only shifting up over the anchor. */
  flipBottomY?: number;
}

const MENU_ATTR = "data-nested-menu";

function Chevron() {
  return (
    <svg width="8" height="8" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Check({ visible }: { visible: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ opacity: visible ? 1 : 0 }}>
      <path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TextRow({
  item,
  onHover,
}: {
  item: Extract<NestedMenuItem, { kind: "text" }>;
  onHover: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const canCommit = draft.trim().length > 0;

  const commit = () => {
    if (!canCommit) return;
    item.onCommit(draft.trim());
    setEditing(false);
    setDraft("");
  };

  if (!editing) {
    return (
      <button
        type="button"
        role="menuitem"
        className="nested-menu__row"
        onMouseEnter={onHover}
        onClick={() => setEditing(true)}
      >
        <span className="flex-1 truncate">{item.label}</span>
        <span className="nested-menu__hint">{item.value}</span>
      </button>
    );
  }

  return (
    <div className="nested-menu__row nested-menu__row--static" onMouseEnter={onHover}>
      <input
        type="text"
        className="nested-menu__input"
        value={draft}
        placeholder={item.placeholder}
        aria-label={item.label}
        autoFocus
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            // Leave the edit only — don't close the whole menu.
            e.stopPropagation();
            setEditing(false);
            setDraft("");
          }
        }}
      />
      {canCommit && (
        <button type="button" className="nested-menu__ok" onClick={commit} title="Apply (Enter)">
          OK
        </button>
      )}
    </div>
  );
}

interface PanelProps {
  x: number;
  y: number;
  items: NestedMenuItem[];
  onClose: () => void;
  /** Submenu: the parent row's left edge, to flip to when it would leave the viewport on the right. */
  flipLeftX?: number;
  flipBottomY?: number;
}

function MenuPanel({ x, y, items, onClose, flipLeftX, flipBottomY }: PanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [openSub, setOpenSub] = useState<{ key: string; x: number; y: number; flipLeftX: number } | null>(null);

  // Re-measured after every render: custom content may change height while open.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const margin = NESTED_MENU.VIEWPORT_MARGIN;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const left = flipLeftX !== undefined && x + width > getViewport().width - margin
      ? flipLeftX - NESTED_MENU.SUBMENU_GAP - width
      : x;
    const top = flipBottomY === undefined ? y : flipAboveIfOverflow(y, height, flipBottomY, margin);
    const next = clampToViewport(left, top, width, height, margin);
    setPos((prev) => (prev && prev.x === next.x && prev.y === next.y ? prev : next));
  });

  const openSubmenu = (key: string, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    setOpenSub({ key, x: rect.right + NESTED_MENU.SUBMENU_GAP, y: rect.top - NESTED_MENU.PADDING_Y, flipLeftX: rect.left });
  };

  const sub = openSub ? items.find((i) => i.key === openSub.key) : undefined;

  return (
    <>
      <div
        ref={panelRef}
        role="menu"
        {...{ [MENU_ATTR]: "" }}
        className="nested-menu"
        style={{
          left: pos ? pos.x : x,
          top: pos ? pos.y : y,
          opacity: pos ? 1 : 0,
          pointerEvents: pos ? "auto" : "none",
        }}
      >
        {items.map((item) => {
          if (item.kind === "separator") return <div key={item.key} role="separator" className="nested-menu__separator" />;

          if (item.kind === "submenu") {
            const isOpen = openSub?.key === item.key;
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={isOpen}
                title={item.title}
                className={`nested-menu__row ${isOpen ? "nested-menu__row--open" : ""}`}
                onMouseEnter={(e) => openSubmenu(item.key, e.currentTarget)}
                onClick={(e) => openSubmenu(item.key, e.currentTarget)}
              >
                <span className="flex-1 truncate">{item.label}</span>
                {item.hint && <span className="nested-menu__hint">{item.hint}</span>}
                <Chevron />
              </button>
            );
          }

          const closeSub = () => setOpenSub(null);

          if (item.kind === "label") {
            return (
              <div
                key={item.key}
                title={item.title ?? item.label}
                className={`nested-menu__label ${item.mono ? "nested-menu__label--mono" : ""}`}
                onMouseEnter={closeSub}
              >
                {item.label}
              </div>
            );
          }

          if (item.kind === "custom") {
            return (
              <div key={item.key} onMouseEnter={closeSub} onKeyDown={(e) => e.stopPropagation()}>
                {item.content}
              </div>
            );
          }

          if (item.kind === "radio") {
            return (
              <button
                key={item.key}
                type="button"
                role="menuitemradio"
                aria-checked={item.checked}
                title={item.title}
                className="nested-menu__row"
                onMouseEnter={closeSub}
                onClick={() => { item.onSelect(); onClose(); }}
              >
                <Check visible={item.checked} />
                <span className="flex-1 truncate">{item.label}</span>
              </button>
            );
          }

          if (item.kind === "toggle") {
            return (
              <button
                key={item.key}
                type="button"
                role="menuitemcheckbox"
                aria-checked={item.checked}
                className="nested-menu__row"
                onMouseEnter={closeSub}
                onClick={() => item.onChange(!item.checked)}
              >
                <Check visible={item.checked} />
                <span className="flex-1 truncate">{item.label}</span>
              </button>
            );
          }

          if (item.kind === "stepper") {
            const set = (v: number) => item.onChange(Math.max(item.min, Math.min(item.max, v)));
            return (
              <div key={item.key} className="nested-menu__row nested-menu__row--static" onMouseEnter={closeSub}>
                <span className="flex-1 truncate">{item.label}</span>
                <button
                  type="button"
                  className="nested-menu__step"
                  onClick={() => set(item.value - 1)}
                  disabled={item.value <= item.min}
                  aria-label={`Decrease ${item.label}`}
                >
                  −
                </button>
                <span className="nested-menu__value">{item.value}</span>
                <button
                  type="button"
                  className="nested-menu__step"
                  onClick={() => set(item.value + 1)}
                  disabled={item.value >= item.max}
                  aria-label={`Increase ${item.label}`}
                >
                  +
                </button>
              </div>
            );
          }

          if (item.kind === "text") {
            return <TextRow key={item.key} item={item} onHover={closeSub} />;
          }

          return (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              title={item.title}
              disabled={item.disabled}
              className={`nested-menu__row ${item.danger ? "nested-menu__row--danger" : ""}`}
              onMouseEnter={closeSub}
              onClick={() => { item.onSelect(); if (!item.keepOpen) onClose(); }}
            >
              <span className="flex-1 truncate">{item.label}</span>
              {item.hint && <span className="nested-menu__hint">{item.hint}</span>}
            </button>
          );
        })}
      </div>
      {sub?.kind === "submenu" && openSub && (
        <MenuPanel key={openSub.key} x={openSub.x} y={openSub.y} flipLeftX={openSub.flipLeftX} items={sub.items} onClose={onClose} />
      )}
    </>
  );
}

/**
 * NestedMenu Component
 *
 * Minimal multi-level dropdown: rows can open a submenu (hover or click), pick
 * a radio value, flip a toggle, step a number, type a short value, or run an action; static
 * labels, separators and custom content (sliders) structure it. Hovering any other row closes
 * an open submenu; a submenu flips left at the right screen edge. Portaled to
 * `document.body`, clamped into the viewport, closes on outside pointerdown or
 * Escape.
 *
 * Usage:
 * ```tsx
 * {menu && (
 *   <NestedMenu
 *     x={menu.x}
 *     y={menu.y}
 *     onClose={() => setMenu(null)}
 *     items={[
 *       { kind: 'submenu', key: 'model', label: 'Model', hint: 'SA3', items: [
 *         { kind: 'radio', key: 'sa3', label: 'SA3', checked: true, onSelect: () => setModel('sa3') },
 *       ] },
 *       { kind: 'stepper', key: 'people', label: 'People', value: 5, min: 0, max: 50, onChange: setPeople },
 *     ]}
 *   />
 * )}
 * ```
 */
export function NestedMenu({ x, y, items, onClose, flipBottomY }: NestedMenuProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target?.closest?.(`[${MENU_ATTR}]`)) return;
      onCloseRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    // Right-clicking inside the menu never opens the browser menu or a menu behind it.
    <div onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <MenuPanel x={x} y={y} items={items} onClose={onClose} flipBottomY={flipBottomY} />
    </div>,
    document.body,
  );
}
