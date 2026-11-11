/**
 * Gumball numeric prompt
 *
 * A small floating input opened next to the pointer when a gumball handle is
 * clicked (not dragged / held): "Move X [ 1.5 ] m", "Rotate Z [ 90 ] °". Enter
 * applies the typed value, Escape or clicking elsewhere cancels. Only one prompt
 * is open at a time. Plain DOM (the gumballs live in imperative three.js code);
 * styled with the globals.css tokens so it follows the light / dark theme.
 *
 * Usage:
 * ```ts
 * openGumballNumericPrompt({
 *   clientX, clientY, label: 'Move X', unit: 'm',
 *   onSubmit: (value) => moveAlongX(value),
 * });
 * ```
 */

import { GUMBALL } from '@/utils/constants';

export interface GumballNumericPromptOptions {
  /** Screen position of the click (the prompt opens just below-right of it). */
  clientX: number;
  clientY: number;
  /** Action label, e.g. "Move X". */
  label: string;
  /** Unit shown after the input, e.g. "m" or "°". */
  unit: string;
  /** Pre-filled value (selected so typing replaces it). */
  initialValue?: number;
  onSubmit: (value: number) => void;
}

let closeCurrent: (() => void) | null = null;

/** Parse a typed number; accepts a decimal comma. Null when not a finite number. */
function parseTypedNumber(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (normalized === '') return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function makeText(text: string, color: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.textContent = text;
  span.style.color = color;
  span.style.whiteSpace = 'nowrap';
  return span;
}

/** Open the prompt (closing any open one). Returns a function that closes it. */
export function openGumballNumericPrompt(opts: GumballNumericPromptOptions): () => void {
  closeCurrent?.();

  const box = document.createElement('div');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', `${opts.label} (${opts.unit})`);
  Object.assign(box.style, {
    position: 'fixed',
    zIndex: '10000',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 8px',
    borderRadius: '6px',
    background: 'var(--background)',
    border: '1px solid var(--color-border-strong)',
    boxShadow: 'var(--shadow-lg)',
    fontSize: '12px',
    fontFamily: 'inherit',
  } satisfies Partial<CSSStyleDeclaration>);

  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.value = opts.initialValue !== undefined ? String(opts.initialValue) : '';
  Object.assign(input.style, {
    width: `${GUMBALL.PROMPT_INPUT_WIDTH_PX}px`,
    padding: '2px 4px',
    borderRadius: '4px',
    border: '1px solid var(--color-border-strong)',
    background: 'var(--color-surface)',
    color: 'var(--foreground)',
    font: 'inherit',
    textAlign: 'right',
    outline: 'none',
  } satisfies Partial<CSSStyleDeclaration>);

  box.append(
    makeText(opts.label, 'var(--color-secondary-hover)'),
    input,
    makeText(opts.unit, 'var(--foreground)'),
  );

  let closed = false;
  // A press anywhere outside the box cancels it. Blur alone is not enough: the
  // Speckle canvas prevents default on pointerdown, so the input keeps focus.
  const onOutsidePointerDown = (e: PointerEvent) => {
    if (!(e.target instanceof Node) || !box.contains(e.target)) close();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    input.removeEventListener('blur', close);
    document.removeEventListener('pointerdown', onOutsidePointerDown, true);
    box.remove();
    if (closeCurrent === close) closeCurrent = null;
  };

  input.addEventListener('keydown', (e) => {
    // Keep app shortcuts (Escape = clear selection, Delete, …) out of the field.
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = parseTypedNumber(input.value);
      if (value === null) {
        input.style.borderColor = 'var(--color-error)';
        return;
      }
      close();
      opts.onSubmit(value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else {
      input.style.borderColor = 'var(--color-border-strong)';
    }
  });
  input.addEventListener('blur', close);
  document.addEventListener('pointerdown', onOutsidePointerDown, true);

  document.body.appendChild(box);

  // Keep the box inside the viewport.
  const offset = GUMBALL.PROMPT_OFFSET_PX;
  const rect = box.getBoundingClientRect();
  const left = Math.min(opts.clientX + offset, window.innerWidth - rect.width - offset);
  const top = Math.min(opts.clientY + offset, window.innerHeight - rect.height - offset);
  box.style.left = `${Math.max(offset, left)}px`;
  box.style.top = `${Math.max(offset, top)}px`;

  closeCurrent = close;
  input.focus();
  input.select();
  return close;
}
