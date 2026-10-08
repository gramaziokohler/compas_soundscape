/**
 * True when the current URL is the fresh Home stage — no `?model_id=` model and
 * no `?home=` project. That stage starts empty on every load and never autosaves.
 * Always false during SSR.
 */
export function isFreshHomeUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return !params.get('model_id') && !params.get('home');
}
