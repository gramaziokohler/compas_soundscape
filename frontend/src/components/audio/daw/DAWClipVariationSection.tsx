'use client';

import { useState } from 'react';
import { RangeSlider } from '@/components/ui/RangeSlider';
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

const rowStyle = { padding: '4px 12px' } as const;
const actionStyle = { padding: '5px 12px', cursor: 'pointer', color: 'var(--foreground)', whiteSpace: 'nowrap' } as const;

/**
 * "Variation" block of the DAW clip menu: pitch / level offset of this one
 * occurrence (lib/audio/utils/clip-variation.ts). Sliders commit on release so a
 * drag does not re-bake the schedule on every tick.
 */
export function DAWClipVariationSection({ variation, isOverridden, onSet, onReroll, onReset }: DAWClipVariationSectionProps) {
  const [cents, setCents] = useState(variation.detuneCents);
  const [db, setDb] = useState(variation.gainDb);

  const hover = (e: React.MouseEvent<HTMLDivElement>, on: boolean) => {
    e.currentTarget.style.backgroundColor = on ? 'var(--color-border)' : 'transparent';
  };

  return (
    <div style={{ borderTop: '1px solid var(--color-border)', marginTop: '4px', paddingTop: '4px' }}>
      <div style={{ ...rowStyle, color: 'var(--color-text-3)', fontSize: '10px' }}>
        Variation {isOverridden ? '(set by hand)' : '(auto)'}
      </div>
      <div style={rowStyle}>
        <RangeSlider
          label="Pitch"
          value={cents}
          min={-CLIP_VARIATION.MAX_DETUNE_CENTS}
          max={CLIP_VARIATION.MAX_DETUNE_CENTS}
          step={5}
          unit="ct"
          defaultValue={0}
          onChange={setCents}
          onChangeCommitted={(v) => onSet(v, db)}
        />
      </div>
      <div style={rowStyle}>
        <RangeSlider
          label="Level"
          value={db}
          min={-CLIP_VARIATION.MAX_GAIN_DB}
          max={CLIP_VARIATION.MAX_GAIN_DB}
          step={0.1}
          precision={1}
          unit="dB"
          defaultValue={0}
          onChange={setDb}
          onChangeCommitted={(v) => onSet(cents, v)}
        />
      </div>
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
