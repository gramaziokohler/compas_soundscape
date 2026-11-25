'use client';

import { useState } from 'react';
import type { ClipVariation } from '@/types/audio';
import { CLIP_VARIATION } from '@/utils/constants';

export interface DAWClipVariationSectionProps {
  /** Variation this occurrence plays with now (automatic or hand-set). */
  variation: ClipVariation;
  /** True when the occurrence has hand-set values (or a re-roll). */
  isOverridden: boolean;
  /** Commit a hand-set pitch (cents) and level (dB). */
  onSet: (detuneCents: number, gainDb: number) => void;
  /** Draw a new automatic variation. */
  onReroll: () => void;
  /** Back to the automatic variation. */
  onReset: () => void;
}

const mutedText = { color: 'var(--color-secondary-hover)', fontSize: '10px' } as const;

interface CompactSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
}

/** One menu-sized slider row: label · range · value (commits on release). */
function CompactSlider({ label, value, min, max, step, format, onChange, onCommit }: CompactSliderProps) {
  return (
    <div style={{ padding: '3px 10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span style={{ ...mutedText, width: 28, flexShrink: 0 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit(Number(e.currentTarget.value))}
        onKeyUp={(e) => onCommit(Number(e.currentTarget.value))}
        onDoubleClick={() => { onChange(0); onCommit(0); }}
        style={{ flex: 1, minWidth: 0, height: 12, accentColor: 'var(--color-primary)' }}
        aria-label={label}
        title="Double-click to reset to 0"
      />
      <span style={{ ...mutedText, width: 40, flexShrink: 0, textAlign: 'right', fontFamily: 'monospace' }}>
        {format(value)}
      </span>
    </div>
  );
}

/**
 * "Variation" block of the DAW clip menu (NestedMenu custom row, styled with its classes): pitch / level offset of this one
 * occurrence (lib/audio/utils/clip-variation.ts). Only the sound changes — the
 * clip keeps its place on the timeline.
 */
export function DAWClipVariationSection({ variation, isOverridden, onSet, onReroll, onReset }: DAWClipVariationSectionProps) {
  const [cents, setCents] = useState(variation.detuneCents);
  const [db, setDb] = useState(variation.gainDb);

  return (
    <div>
      <div className="nested-menu__label">
        Variation {isOverridden ? '· set by hand' : '· auto'}
      </div>
      <CompactSlider
        label="Pitch"
        value={cents}
        min={-CLIP_VARIATION.MAX_DETUNE_CENTS}
        max={CLIP_VARIATION.MAX_DETUNE_CENTS}
        step={5}
        format={(v) => `${v > 0 ? '+' : ''}${v} ct`}
        onChange={setCents}
        onCommit={(v) => onSet(v, db)}
      />
      <CompactSlider
        label="Level"
        value={db}
        min={-CLIP_VARIATION.MAX_GAIN_DB}
        max={CLIP_VARIATION.MAX_GAIN_DB}
        step={0.1}
        format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
        onChange={setDb}
        onCommit={(v) => onSet(cents, v)}
      />
      <button
        type="button"
        role="menuitem"
        className="nested-menu__row"
        onClick={onReroll}
        title="Draw a new random pitch and level for this occurrence"
      >
        Re-roll variation
      </button>
      {isOverridden && (
        <button type="button" role="menuitem" className="nested-menu__row" onClick={onReset}>
          Reset to auto
        </button>
      )}
    </div>
  );
}
