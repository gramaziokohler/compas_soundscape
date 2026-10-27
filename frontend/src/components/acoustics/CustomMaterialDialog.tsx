'use client';

/**
 * CustomMaterialDialog
 *
 * Create / edit a user-defined acoustic material: name, optional description,
 * an optional "Start from" template (copies any material's spectrum, resampled
 * to the 7 octave bands), and either one flat absorption value or one
 * coefficient per band. A live histogram, the mean absorption and the viewer
 * colour preview the result. Enter saves, Escape cancels.
 *
 * Rendered by CustomMaterialDialogsHost from `customMaterialStore.dialog`.
 */

import { useMemo, useState } from 'react';
import { useAcousticMaterialStore, useCustomMaterialStore, findCustomMaterial } from '@/store';
import { ModalShell } from '@/components/ui/ModalShell';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { ToggleField } from '@/components/ui/ToggleField';
import { MaterialSelect } from '@/components/ui/MaterialSelect';
import { buildAbsorptionHistogramSVG } from '@/lib/audio/utils/absorption-histogram-utils';
import { bandLabel, isFlat, meanAbsorption, resampleToCustomBands } from '@/lib/acoustics/custom-materials';
import { getMaterialColorByAbsorption } from '@/utils/utils';
import { CUSTOM_MATERIAL, FORM_FIELD_CLASS, UI_BORDER_RADIUS } from '@/utils/constants';

const BANDS: readonly number[] = CUSTOM_MATERIAL.CENTER_FREQS;

interface CustomMaterialDialogProps {
  materialId?: string;
  templateId?: string;
  onSaved?: (materialId: string) => void;
}

function initialState(materialId?: string, templateId?: string) {
  const source = materialId ? findCustomMaterial(materialId) : undefined;
  if (source) {
    return { name: source.name, description: source.description, coeffs: resampleToCustomBands(source.coeffs, source.center_freqs) };
  }
  const template = templateId
    ? findCustomMaterial(templateId) ?? useAcousticMaterialStore.getState().availableMaterials.find((m) => m.id === templateId)
    : undefined;
  if (template) {
    return {
      name: `${template.name} (copy)`.slice(0, CUSTOM_MATERIAL.NAME_MAX_LEN),
      description: template.description ?? '',
      coeffs: resampleToCustomBands(template.coeffs ?? [template.absorption], template.center_freqs),
    };
  }
  return { name: '', description: '', coeffs: BANDS.map(() => CUSTOM_MATERIAL.DEFAULT_COEFF) };
}

export function CustomMaterialDialog({ materialId, templateId, onSaved }: CustomMaterialDialogProps) {
  const isEdit = !!materialId;
  const create = useCustomMaterialStore((s) => s.create);
  const update = useCustomMaterialStore((s) => s.update);
  const closeDialog = useCustomMaterialStore((s) => s.closeDialog);
  const library = useCustomMaterialStore((s) => s.library);
  const availableMaterials = useAcousticMaterialStore((s) => s.availableMaterials);

  const [initial] = useState(() => initialState(materialId, templateId));
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [coeffs, setCoeffs] = useState<number[]>(initial.coeffs);
  const [flat, setFlat] = useState(() => isFlat(initial.coeffs));
  const [templateValue, setTemplateValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Templates: every material the pickers offer, plus my library when no card is active.
  const templates = useMemo(() => {
    const byId = new Map(availableMaterials.map((m) => [m.id, m]));
    for (const m of library) if (!byId.has(m.id)) byId.set(m.id, { ...m, isCustom: true });
    return [...byId.values()]
      .filter((m) => m.id !== materialId && typeof m.absorption === 'number')
      .sort((a, b) => a.absorption - b.absorption);
  }, [availableMaterials, library, materialId]);
  const templateColors = useMemo(
    () => new Map(templates.map((m) => [m.id, getMaterialColorByAbsorption(m.absorption)])),
    [templates],
  );

  const trimmedName = name.trim();
  const duplicateName = library.some(
    (m) => m.id !== materialId && m.name.toLowerCase() === trimmedName.toLowerCase(),
  );
  const canSave = trimmedName.length > 0 && !saving;
  const mean = meanAbsorption(coeffs);
  const histogramSvg = useMemo(() => buildAbsorptionHistogramSVG(coeffs, [...BANDS]), [coeffs]);

  const applyTemplate = (id: string) => {
    setTemplateValue(id);
    const template = templates.find((m) => m.id === id);
    if (!template) return;
    const next = resampleToCustomBands(template.coeffs ?? [template.absorption], template.center_freqs);
    setCoeffs(next);
    setFlat(isFlat(next));
    if (!trimmedName) setName(`${template.name} (copy)`.slice(0, CUSTOM_MATERIAL.NAME_MAX_LEN));
  };

  const setBand = (index: number, value: number) =>
    setCoeffs((prev) => prev.map((c, i) => (i === index ? value : c)));

  const toggleFlat = (on: boolean) => {
    setFlat(on);
    // Collapsing to one value keeps the current mean so the material's overall absorption is unchanged.
    if (on) setCoeffs(BANDS.map(() => Math.round(mean * 100) / 100));
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const input = { name: trimmedName, description: description.trim(), coeffs };
      const saved = isEdit ? await update(materialId!, input) : await create(input);
      if (!isEdit) onSaved?.(saved.id);
      closeDialog();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save material');
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={isEdit ? 'Edit material' : 'New acoustic material'}
      onClose={closeDialog}
      width={CUSTOM_MATERIAL.EDITOR_WIDTH}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xxs card-label text-secondary-hover">Name</span>
          <input
            type="text"
            autoFocus
            className={FORM_FIELD_CLASS}
            style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
            maxLength={CUSTOM_MATERIAL.NAME_MAX_LEN}
            placeholder="e.g. Acoustic ceiling tile 20 mm"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {duplicateName && (
            <span className="text-[10px]" style={{ color: 'var(--color-warning-hover)' }}>
              You already have a material with this name.
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xxs card-label text-secondary-hover">Description (optional)</span>
          <input
            type="text"
            className={FORM_FIELD_CLASS}
            style={{ borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
            maxLength={CUSTOM_MATERIAL.DESCRIPTION_MAX_LEN}
            placeholder="Product, source of the data, mounting…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        {templates.length > 0 && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xxs card-label text-secondary-hover">Start from</span>
            <MaterialSelect
              value={templateValue}
              onChange={applyTemplate}
              materials={templates}
              materialColors={templateColors}
              placeholder="Existing material…"
              allowClear={false}
              showSearch
              variant="explorer"
            />
          </div>
        )}

        <div className="flex gap-3 items-start">
          <div
            className="shrink-0"
            style={{
              width: CUSTOM_MATERIAL.PREVIEW_W,
              height: CUSTOM_MATERIAL.PREVIEW_H,
              borderRadius: `${UI_BORDER_RADIUS.SM}px`,
              overflow: 'hidden',
              border: '1px solid var(--color-secondary-light)',
            }}
            aria-label="Absorption by frequency band"
            dangerouslySetInnerHTML={{ __html: histogramSvg }}
          />
          <div className="flex flex-col gap-1 text-xs">
            <span className="text-xxs card-label text-secondary-hover">Mean absorption</span>
            <span className="flex items-center gap-1.5 font-semibold text-foreground">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: getMaterialColorByAbsorption(mean) }}
                aria-hidden
              />
              {(mean * 100).toFixed(0)}%
            </span>
            <span className="text-[10px] text-secondary-hover leading-snug">
              0 = fully reflective, 1 = fully absorptive. The colour is how surfaces appear in the viewer.
            </span>
          </div>
        </div>

        <ToggleField checked={flat} onChange={toggleFlat} label="Same absorption at all frequencies" />

        <div className="flex flex-col gap-1.5">
          {flat ? (
            <RangeSlider
              label="Absorption"
              value={coeffs[0]}
              min={CUSTOM_MATERIAL.COEFF_MIN}
              max={CUSTOM_MATERIAL.COEFF_MAX}
              step={CUSTOM_MATERIAL.COEFF_STEP}
              onChange={(v) => setCoeffs(BANDS.map(() => v))}
            />
          ) : (
            BANDS.map((freq, i) => (
              <RangeSlider
                key={freq}
                label={bandLabel(freq)}
                value={coeffs[i]}
                min={CUSTOM_MATERIAL.COEFF_MIN}
                max={CUSTOM_MATERIAL.COEFF_MAX}
                step={CUSTOM_MATERIAL.COEFF_STEP}
                onChange={(v) => setBand(i, v)}
              />
            ))
          )}
        </div>

        {error && (
          <p className="text-[10px] font-medium" style={{ color: 'var(--color-error)' }}>{error}</p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={closeDialog}
            className="flex-1 py-1.5 text-xs font-medium rounded transition-colors"
            style={{ background: 'var(--color-secondary-lighter)', color: 'var(--foreground)', borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="flex-1 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40"
            style={{ background: 'var(--color-primary)', color: 'var(--color-on-blue)', borderRadius: `${UI_BORDER_RADIUS.SM}px` }}
          >
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create material'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
