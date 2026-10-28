'use client';

/**
 * SoundDirectivityRow
 *
 * The "Directivity" block of a sound card: the pattern picker and, for a
 * directional source, its yaw / pitch / roll (same convention as listeners:
 * yaw 0 faces -Y, +pitch up). Omnidirectional sources show the picker only.
 *
 * Usage:
 * ```tsx
 * <SoundDirectivityRow directivity={sound.directivity} onChange={(d) => updateSoundDirectivity(sound.id, d)} />
 * ```
 */

import { useCallback } from 'react';
import { DirectivitySelect } from './DirectivitySelect';
import { OrientationWidget, type OrientationValue } from '@/components/ui/OrientationWidget';
import { isOmniDirectivity } from '@/utils/positionKey';
import type { SoundDirectivity } from '@/types/directivity';

export interface SoundDirectivityRowProps {
  directivity?: SoundDirectivity;
  onChange: (next: SoundDirectivity | undefined) => void;
  disabled?: boolean;
  onBlueBackground?: boolean;
}

export function SoundDirectivityRow({ directivity, onChange, disabled = false, onBlueBackground = false }: SoundDirectivityRowProps) {
  const directional = !isOmniDirectivity(directivity);

  const handleOrientation = useCallback(
    (next: OrientationValue) => {
      if (!directivity) return;
      onChange({ ...directivity, ...next });
    },
    [directivity, onChange],
  );

  const handleReset = useCallback(() => {
    if (!directivity) return;
    onChange({ ...directivity, yaw: 0, pitch: 0, roll: 0 });
  }, [directivity, onChange]);

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span
        className={`text-[10px] ${onBlueBackground ? '' : 'text-secondary-hover'}`}
        style={onBlueBackground ? { color: 'var(--color-on-blue-muted)' } : undefined}
      >
        Directivity
      </span>
      <DirectivitySelect value={directivity} onChange={onChange} disabled={disabled} onBlueBackground={onBlueBackground} />
      {directional && directivity && (
        <OrientationWidget
          value={{ yaw: directivity.yaw ?? 0, pitch: directivity.pitch ?? 0, roll: directivity.roll ?? 0 }}
          onChange={handleOrientation}
          onReset={handleReset}
          accentColor={onBlueBackground ? 'var(--color-on-blue)' : 'var(--color-primary)'}
          disabled={disabled}
          onBlueBackground={onBlueBackground}
        />
      )}
    </div>
  );
}
