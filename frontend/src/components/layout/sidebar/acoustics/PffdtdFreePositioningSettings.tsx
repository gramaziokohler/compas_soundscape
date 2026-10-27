/**
 * PffdtdFreePositioningSettings Component
 *
 * "Free positioning" block of the wave-based card settings: on/off, then
 * Free listener (forward: one GPU run per source records a grid of listener
 * points) or Free source (reciprocal: one run per listener, ×4 in FOA, records
 * a grid of source points), plus the grid spacing. After the run, moving the
 * free object swaps in the nearest grid point's IR without a new GPU run
 * (hooks/usePffdtdFreeMovement.ts).
 */

'use client';

import { PFFDTD } from '@/utils/constants';
import type { PffdtdFreeMode, PffdtdSettings } from '@/types/pffdtd';
import { ToggleField } from '@/components/ui/ToggleField';
import { OptionToggle } from '@/components/ui/OptionToggle';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { useDirectionalSources } from '@/hooks/useDirectionalSources';

type FreeSide = Exclude<PffdtdFreeMode, 'off'>;

const DIRECTIONAL_LISTENER_TITLE =
  'Free listener runs forward from each source and cannot radiate a directional source — set the sources to omnidirectional or use Free source.';

interface PffdtdFreePositioningSettingsProps {
  settings: PffdtdSettings;
  disabled: boolean;
  isSettingModified: (field: keyof PffdtdSettings) => boolean;
  onChange: <K extends keyof PffdtdSettings>(field: K, value: PffdtdSettings[K]) => void;
}

const SIDE_HELP: Record<FreeSide, string> = {
  listener:
    'One GPU run per source, as usual (GPU time barely changes). Listeners can then move: each snaps to the nearest grid point.',
  source:
    'One GPU run per listener (×4 for FOA). Sources (omnidirectional) can then move: each snaps to the nearest grid point.',
};

export function PffdtdFreePositioningSettings({
  settings: s,
  disabled,
  isSettingModified,
  onChange,
}: PffdtdFreePositioningSettingsProps) {
  const enabled = s.free_mode !== 'off';
  const side: FreeSide = s.free_mode === 'source' ? 'source' : 'listener';
  // Directional sources run reciprocally (from the listeners): Free listener is unavailable.
  const { directionalCount } = useDirectionalSources();
  const listenerBlocked = directionalCount > 0;

  return (
    <div className="card-stack--tight">
      <ToggleField
        checked={enabled}
        onChange={(checked) => onChange('free_mode', checked ? (listenerBlocked ? 'source' : side) : 'off')}
        label="Free positioning"
        modified={isSettingModified('free_mode')}
        disabled={disabled}
      />
      {enabled && (
        <>
          <OptionToggle<FreeSide>
            value={side}
            onChange={(v) => onChange('free_mode', v)}
            options={[
              {
                value: 'listener',
                label: 'Free listener',
                title: listenerBlocked ? DIRECTIONAL_LISTENER_TITLE : SIDE_HELP.listener,
                disabled: disabled || listenerBlocked,
              },
              { value: 'source', label: 'Free source', title: SIDE_HELP.source, disabled },
            ]}
          />
          {listenerBlocked && side === 'listener' && (
            <span className="text-xxs" style={{ color: 'var(--color-error)' }}>{DIRECTIONAL_LISTENER_TITLE}</span>
          )}
          <RangeSlider
            label="Grid spacing"
            unit="m"
            modified={isSettingModified('free_grid_spacing')}
            value={s.free_grid_spacing}
            min={PFFDTD.FREE_GRID_SPACING_MIN}
            max={PFFDTD.FREE_GRID_SPACING_MAX}
            step={PFFDTD.FREE_GRID_SPACING_STEP}
            onChange={(v) => onChange('free_grid_spacing', v)}
            disabled={disabled}
            defaultValue={PFFDTD.FREE_GRID_SPACING_DEFAULT}
            sliderTitle="Memory grows as 1 / spacing³; the spacing is coarsened automatically if the recording would not fit"
          />
          <span className="text-xxs text-secondary-hover">
            {SIDE_HELP[side]} Moves farther than {PFFDTD.FREE_SNAP_RADIUS_M} m from a grid point need a
            re-run.{side === 'source' ? ' No strength-G volume or wave animation in this mode.' : ''}
          </span>
        </>
      )}
    </div>
  );
}
