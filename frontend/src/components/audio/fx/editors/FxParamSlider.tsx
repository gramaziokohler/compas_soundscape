'use client';

import { RangeSlider } from '@/components/ui/RangeSlider';
import { useBatchedSlider } from '@/hooks/useBatchedSlider';

interface FxParamSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  defaultValue?: number;
  onLive: (value: number) => void;
  onCommit: (value: number) => void;
}

/**
 * RangeSlider wired to the soundFx temporal store (one undo entry per drag).
 */
export function FxParamSlider({
  label, value, min, max, step, unit, defaultValue, onLive, onCommit,
}: FxParamSliderProps) {
  const batched = useBatchedSlider('soundFx', onLive, onCommit);
  return (
    <RangeSlider
      label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      unit={unit}
      defaultValue={defaultValue}
      onDragStart={batched.onDragStart}
      onChange={batched.onChange}
      onChangeCommitted={batched.onCommit}
    />
  );
}
