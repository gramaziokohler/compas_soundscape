/**
 * TTS delivery-style text helpers (card field `voice_style`).
 *
 * A style is free English text; the helper chips (TTS_STYLE.PRESETS) are parts of
 * it separated by TTS_STYLE.SEPARATOR, so "whispering, slow" lights the Whisper
 * and Slow chips and the user can still type anything around them.
 */
import { TTS_STYLE } from '@/utils/constants';

const norm = (text: string) => text.trim().toLowerCase();

/** The comma-separated parts of a style, trimmed, empties dropped. */
export function splitStyle(style: string | undefined): string[] {
  return (style ?? '').split(',').map((p) => p.trim()).filter(Boolean);
}

/** Labels of the presets present in the style. */
export function activeStylePresetLabels(style: string | undefined): string[] {
  const parts = new Set(splitStyle(style).map(norm));
  return TTS_STYLE.PRESETS.filter((p) => parts.has(norm(p.value))).map((p) => p.label);
}

/**
 * The style after the chips were set to `labels`: preset parts no longer selected
 * are removed, newly selected ones appended, free-text parts kept in place.
 */
export function applyStylePresetLabels(style: string | undefined, labels: readonly string[]): string {
  const wanted = new Set(labels);
  const presetByValue = new Map(TTS_STYLE.PRESETS.map((p) => [norm(p.value), p]));
  const kept = splitStyle(style).filter((part) => {
    const preset = presetByValue.get(norm(part));
    return !preset || wanted.has(preset.label);
  });
  const keptNorm = new Set(kept.map(norm));
  const added = TTS_STYLE.PRESETS
    .filter((p) => wanted.has(p.label) && !keptNorm.has(norm(p.value)))
    .map((p) => p.value);
  return [...kept, ...added].join(TTS_STYLE.SEPARATOR).slice(0, TTS_STYLE.MAX_CHARS);
}

/** Style to send / store: one line, trimmed, capped; undefined when neutral. */
export function cleanStyle(style: string | undefined): string | undefined {
  const text = (style ?? '').replace(/\s+/g, ' ').trim().slice(0, TTS_STYLE.MAX_CHARS);
  return text || undefined;
}
