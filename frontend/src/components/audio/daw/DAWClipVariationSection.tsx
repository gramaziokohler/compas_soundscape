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

const actionStyle = { padding: '5px 12px', cursor: 'pointer', color: 'var(--foreground)', whiteSpace: 'nowrap' } as const;
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
    <div style={{ padding: '3px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
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
 * "Variation" block of the DAW clip menu: pitch / level offset of this one
 * occurrence (lib/audio/utils/clip-variation.ts). Only the sound changes — the
 * clip keeps its place on the timeline.
 */
export function DAWClipVariationSection({ variation, isOverridden, onSet, onReroll, onReset }: DAWClipVariationSectionProps) {
  const [cents, setCents] = useState(variation.detuneCents);
  const [db, setDb] = useState(variation.gainDb);

  const hover = (e: React.MouseEvent<HTMLDivElement>, on: boolean) => {
    e.currentTarget.style.backgroundColor = on ? 'var(--color-border)' : 'transparent';
  };

  return (
    <div style={{ borderTop: '1px solid var(--color-border)', marginTop: '4px', paddingTop: '4px' }}>
      <div style={{ padding: '2px 12px', ...mutedText }}>
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
      <div
        style={actionStyle}
        onMouseEnter={(e) => hover(e, true)}
        onMouseLeave={(e) => hover(e, false)}
        onClick={onReroll}
        title="Draw a new random pitch and level for this occurrence"
      >
        Re-roll variation
      </div>
      {isOverridden && (
        <div
          style={actionStyle}
          onMouseEnter={(e) => hover(e, true)}
          onMouseLeave={(e) => hover(e, false)}
          onClick={onReset}
        >
          Reset to auto
        </div>
      )}
    </div>
  );
}
