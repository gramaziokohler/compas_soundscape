/** Keyboard event helpers shared by the global shortcut hooks. */

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

type AnyKeyboardEvent = KeyboardEvent | ReactKeyboardEvent;

const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file']);

/** True when keystrokes on this element are text entry (typing must not trigger shortcuts). */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUT_TYPES.has((el as HTMLInputElement).type);
  return false;
}

/** True when Space/Enter on this element would activate it natively. */
export function isActivatableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'SUMMARY' || el.tagName === 'INPUT') return true;
  const role = el.getAttribute('role');
  return role === 'button' || role === 'menuitem' || role === 'option' || role === 'tab' || role === 'checkbox';
}

/** Platform modifier: Ctrl on Windows/Linux, Cmd on macOS. */
export function hasModKey(e: AnyKeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey;
}

export function isModEnter(e: AnyKeyboardEvent): boolean {
  return e.key === 'Enter' && hasModKey(e) && !e.altKey;
}

/** A modal is open — it owns the keyboard, so global shortcuts stand down. */
export function isModalOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('[aria-modal="true"]') !== null;
}

/** Any dialog (modal or popover) is open — it handles Escape itself. */
export function isDialogOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('[role="dialog"], [aria-modal="true"]') !== null;
}

// How the current focus was reached. `:focus-visible` can't be used for this:
// browsers flip it to true on the first key press, so a clicked button would
// already count as keyboard-focused when Space arrives.
let focusedByPointer = false;

const markPointer = () => { focusedByPointer = true; };
const markKeyboard = (e: KeyboardEvent) => {
  // Picking a <datalist> option dispatches a keydown with no `key` in Chromium.
  if (typeof e.key !== 'string') return;
  if (e.key === 'Tab' || e.key.startsWith('Arrow')) focusedByPointer = false;
};

/** Track focus modality (pointer vs Tab). Returns a cleanup fn. Install once. */
export function installFocusModalityTracking(): () => void {
  window.addEventListener('pointerdown', markPointer, true);
  window.addEventListener('keydown', markKeyboard, true);
  return () => {
    window.removeEventListener('pointerdown', markPointer, true);
    window.removeEventListener('keydown', markKeyboard, true);
  };
}

/**
 * Keyboard-focused control (Tab navigation) — Space should activate it.
 * A control focused by a mouse click returns false, so Space goes to the app
 * shortcut instead of re-clicking whatever was clicked last.
 */
export function isKeyboardFocusedControl(el: EventTarget | null): boolean {
  return isActivatableTarget(el) && !focusedByPointer;
}
