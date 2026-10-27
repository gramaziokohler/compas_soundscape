'use client';

/**
 * DirectivitySelect
 *
 * Dropdown of the radiation patterns a sound source can use: the analytical
 * Cardioid family, the measured built-in presets (loudspeaker / human speaker),
 * the user's imported balloons ("· mine") and the ones shared by the loaded
 * soundscape ("· shared"). The sticky footer imports a SOFA / BRAS file or opens
 * the library manager (both dialogs are rendered once by DirectivityDialogsHost).
 *
 * Usage:
 * ```tsx
 * <DirectivitySelect value={sound.directivity} onChange={(d) => updateSoundDirectivity(sound.id, d)} />
 * ```
 */

import { useEffect, useMemo } from 'react';
import { CardSelect, type CardSelectOption } from '@/components/ui/CardSelect';
import { useDirectivityStore } from '@/store/directivityStore';
import { DIRECTIVITY } from '@/utils/constants';
import type { DirectivityRecord, SoundDirectivity } from '@/types/directivity';

export interface DirectivitySelectProps {
  value?: SoundDirectivity;
  /** `undefined` = omnidirectional. The orientation of the previous value is kept. */
  onChange: (next: SoundDirectivity | undefined) => void;
  disabled?: boolean;
  onBlueBackground?: boolean;
}

function recordOption(record: DirectivityRecord, tag?: string): CardSelectOption {
  const suffix = !record.available ? ` · ${DIRECTIVITY.PREPARING_TAG}` : tag ? ` · ${tag}` : '';
  return {
    value: record.id,
    label: `${record.name}${suffix}`,
    disabled: !record.available,
    title: !record.available
      ? 'This preset is still being prepared on the server'
      : record.kind === 'measured'
        ? `Measured balloon${record.source_label ? ` (${record.source_label})` : ''}${record.n_points ? `, ${record.n_points} directions` : ''}`
        : undefined,
  };
}

export function DirectivitySelect({ value, onChange, disabled = false, onBlueBackground = false }: DirectivitySelectProps) {
  const presets = useDirectivityStore((s) => s.presets);
  const library = useDirectivityStore((s) => s.library);
  const snapshot = useDirectivityStore((s) => s.snapshot);
  const load = useDirectivityStore((s) => s.load);
  const openImport = useDirectivityStore((s) => s.openImport);
  const openManager = useDirectivityStore((s) => s.openManager);

  useEffect(() => {
    void load();
  }, [load]);

  const currentId = value?.id ?? DIRECTIVITY.OMNI_ID;

  const options = useMemo<CardSelectOption[]>(() => {
    const analytical: CardSelectOption[] = DIRECTIVITY.ANALYTICAL_PRESETS.map((p) => ({ value: p.id, label: p.label }));
    const measured = presets.filter((r) => r.kind === 'measured').map((r) => recordOption(r));
    const libraryIds = new Set(library.map((r) => r.id));
    const mine = library.map((r) => recordOption(r, DIRECTIVITY.CUSTOM_TAG));
    const shared = snapshot.filter((r) => !libraryIds.has(r.id)).map((r) => recordOption(r, DIRECTIVITY.SHARED_TAG));
    const all = [...analytical, ...measured, ...mine, ...shared];
    // A directivity the current sound uses but nobody lists any more (deleted): keep it selectable so the label shows.
    if (!all.some((o) => o.value === currentId)) {
      all.push({ value: currentId, label: `${currentId} · missing`, title: 'This directivity is no longer available — pick another one' });
    }
    return all;
  }, [presets, library, snapshot, currentId]);

  const handleChange = (id: string) => {
    if (id === DIRECTIVITY.OMNI_ID) {
      onChange(undefined);
      return;
    }
    onChange({ id, yaw: value?.yaw ?? 0, pitch: value?.pitch ?? 0, roll: value?.roll ?? 0 });
  };

  const assignImported = (record: DirectivityRecord) =>
    onChange({ id: record.id, yaw: value?.yaw ?? 0, pitch: value?.pitch ?? 0, roll: value?.roll ?? 0 });

  return (
    <CardSelect
      value={currentId}
      onChange={handleChange}
      options={options}
      disabled={disabled}
      compact
      forceMenu
      menuWidth="content"
      triggerStyle={onBlueBackground ? { color: 'var(--color-on-blue)', borderColor: 'var(--color-on-blue-muted)' } : undefined}
      menuFooter={(close) => (
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            className="select-opt compact flex-1 text-left font-semibold"
            style={{ color: 'var(--color-primary)' }}
            onClick={() => {
              close();
              openImport({ onImported: assignImported });
            }}
          >
            {DIRECTIVITY.IMPORT_LABEL}
          </button>
          {library.length > 0 && (
            <button
              type="button"
              className="select-opt compact shrink-0 text-right text-secondary-hover"
              onClick={() => {
                close();
                openManager();
              }}
            >
              {DIRECTIVITY.MANAGE_LABEL} ({library.length})
            </button>
          )}
        </div>
      )}
    />
  );
}
