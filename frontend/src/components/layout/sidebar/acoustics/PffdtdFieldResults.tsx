/**
 * PffdtdFieldResults — field outputs of a completed wave-based card.
 *
 * Picks the 3D overlay (none / SPL map / wave animation), the source and,
 * for the strength-G volume, the slice (horizontal at any height — default
 * the listener height — or vertical at any x / y) — remembered per card, so
 * switching cards and back restores them. Shows the colour bar and drives the
 * animation playback (play / pause, frame scrubber, fps). Runs that kept their
 * voxel grid generate the wave animation on demand at a chosen height
 * (`PffdtdAnimationGenerator`; the viewer previews the strength-G slice there). Field data is
 * fetched lazily from the results JSON and cached in `pffdtdVisualsStore`;
 * the scene hook draws the plane. Results without a volume show their plane map.
 */

'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Pause, Play } from 'lucide-react';
import { usePffdtdVisualsStore } from '@/store';
import { CardSelect } from '@/components/ui/CardSelect';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { Notice } from '@/components/ui/Notice';
import { NumberField } from '@/components/ui/NumberField';
import { estimateFieldWidthCh } from '@/components/ui/numberFieldSizing';
import { DIVERGING_CSS_GRADIENT, SEQUENTIAL_CSS_GRADIENT } from '@/lib/three/colormaps';
import { applyLegendBounds, splDisplayRange } from '@/lib/acoustics/pffdtd-field';
import {
  animationHeight,
  animationPlaneMatches,
  defaultSlice,
  defaultSlicePosition,
  volumeAxisRange,
} from '@/lib/acoustics/pffdtd-volume';
import { PffdtdAnimationGenerator } from './PffdtdAnimationGenerator';
import { PFFDTD_VISUALS } from '@/utils/constants';
import { PFFDTD_ALL_SOURCES, type PffdtdSliceAxis } from '@/types/pffdtd';

interface PffdtdFieldResultsProps {
  configId: string;
  simulationId: string;
  sourceDisplayNames?: Record<string, string>;
  /** True when rendered on a solid generated (blue) card. */
  onBlueBackground?: boolean;
}

type OverlayChoice = 'none' | 'spl' | 'field';

const SLICE_AXIS_OPTIONS: Array<{ value: PffdtdSliceAxis; label: string }> = [
  { value: 'z', label: 'Horizontal' },
  { value: 'x', label: 'Vertical, fixed x' },
  { value: 'y', label: 'Vertical, fixed y' },
];
const SLICE_POSITION_LABEL: Record<PffdtdSliceAxis, string> = { z: 'Height', x: 'x', y: 'y' };

const LEGEND_FIELD_PRECISION = 1;
const LEGEND_FIELD_WIDTH_CH = estimateFieldWidthCh(-100, 200, LEGEND_FIELD_PRECISION);

/** Editable colour-bar bound: the same field as a RangeSlider's value (NumberField + unit). */
function LegendBoundField({ label, value, onChange, onBlueBackground }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onBlueBackground: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1 shrink-0" title={`${label} (dB)`}>
      <NumberField
        value={value}
        precision={LEGEND_FIELD_PRECISION}
        onChange={onChange}
        onBlueBackground={onBlueBackground}
        containerStyle={{ width: `${LEGEND_FIELD_WIDTH_CH}ch` }}
        className="!text-xs !py-0.5"
        aria-label={label}
      />
      <span
        className="text-[10px] whitespace-nowrap"
        style={{ color: onBlueBackground ? 'var(--color-on-blue-muted)' : 'var(--color-secondary-hover)' }}
      >
        dB
      </span>
    </span>
  );
}

export function PffdtdFieldResults({ configId, simulationId, sourceDisplayNames, onBlueBackground = false }: PffdtdFieldResultsProps) {
  const field = usePffdtdVisualsStore((s) => s.fields[simulationId]);
  const overlay = usePffdtdVisualsStore((s) => s.overlay);
  const playing = usePffdtdVisualsStore((s) => s.playing);
  const frame = usePffdtdVisualsStore((s) => s.frame);
  const fps = usePffdtdVisualsStore((s) => s.fps);
  const { setOverlay, selectFieldView, setFieldSlice, setFieldLegend, setPlaying, setFrame, setFps, loadField, loadSourceData } = usePffdtdVisualsStore.getState();

  const block = field?.block ?? null;
  const ownOverlay = overlay?.configId === configId && overlay.kind !== 'voxels' ? overlay : null;
  const choice: OverlayChoice = ownOverlay && ownOverlay.kind !== 'voxels' ? ownOverlay.kind : 'none';
  const sourceId = ownOverlay?.sourceId ?? null;

  useEffect(() => { void loadField(simulationId); }, [simulationId, loadField]);

  // Download the buffers the chosen overlay needs (the animation also previews strength G).
  useEffect(() => {
    if (!block || !ownOverlay?.sourceId) return;
    const { kind, sourceId: id } = ownOverlay;
    if (kind === 'spl' || (kind === 'field' && block.animation_on_demand)) void loadSourceData(simulationId, id, 'spl');
    if (kind === 'field') void loadSourceData(simulationId, id, 'frames');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block, simulationId, ownOverlay?.kind, ownOverlay?.sourceId, loadSourceData]);

  // Hide this card's overlay when the results unmount (collapsed / removed).
  useEffect(() => () => {
    const s = usePffdtdVisualsStore.getState();
    if (s.overlay?.configId === configId && s.overlay.kind !== 'voxels') s.setOverlay(null);
  }, [configId]);

  const animatedSources = useMemo(() => block?.sources.filter((s) => s.animation) ?? [], [block]);
  // Runs that kept their voxel grid animate any source on demand; older ones only what they recorded.
  const onDemand = !!block?.animation_on_demand && !!block.volume;
  const fieldSources = onDemand && block ? block.sources : animatedSources;
  const nameOf = (id: string) => sourceDisplayNames?.[id] ?? id;

  /** Whether `id` is a valid source for the overlay kind in this simulation. */
  const isValidSource = (kind: 'spl' | 'field', id: string) =>
    !!block && (kind === 'field'
      ? fieldSources.some((s) => s.source_id === id)
      : (id === PFFDTD_ALL_SOURCES && block.sources.length > 1) || block.sources.some((s) => s.source_id === id));

  // Reopening the card brings back the overlay + source it last showed (remembered per card).
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!block || restoredRef.current) return;
    restoredRef.current = true;
    const view = usePffdtdVisualsStore.getState().fieldViews[configId];
    if (view && isValidSource(view.kind, view.sourceId)) {
      setOverlay({ configId, kind: view.kind, simulationId, sourceId: view.sourceId, slice: view.slice ?? null, legend: view.legend ?? null });
    }
    // Runs once, when the field block first becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block]);

  const select = (kind: OverlayChoice, nextSource?: string) => {
    if (kind === 'none' || !block) return selectFieldView(configId, simulationId, null);
    const pool = (kind === 'field' ? fieldSources : block.sources).map((s) => s.source_id);
    const fallback = kind === 'spl' && block.sources.length > 1 ? PFFDTD_ALL_SOURCES : pool[0];
    const id = nextSource ?? (sourceId && isValidSource(kind, sourceId) ? sourceId : fallback);
    if (!id) return selectFieldView(configId, simulationId, null);
    // The legend bounds belong to one source's map: they are dropped when the source or kind changes.
    const sameMap = ownOverlay?.kind === kind && ownOverlay.sourceId === id;
    selectFieldView(configId, simulationId, { kind, sourceId: id, slice: ownOverlay?.slice ?? null, legend: sameMap ? ownOverlay?.legend ?? null : null });
  };

  const mutedStyle = { color: onBlueBackground ? 'var(--color-on-blue-muted)' : 'var(--color-secondary-hover)' };

  if (!field || field.status === 'loading') {
    return <p className="text-xxs" style={mutedStyle}>Loading field data…</p>;
  }
  if (field.status === 'missing' || field.expired) {
    return <Notice type="warning" message="The SPL map / wave animation files have expired on the server. Re-run the simulation to regenerate them." />;
  }
  if (field.status === 'error' || !block) {
    return field.error ? <Notice type="error" message={field.error} /> : null;
  }

  const splMap = sourceId ? field.spl[sourceId] : undefined;
  const animZ = animationHeight(block, ownOverlay?.slice);
  const recorded = choice === 'field' ? block.sources.find((s) => s.source_id === sourceId)?.animation ?? null : null;
  // Frames play only on the plane they were recorded on; elsewhere the viewer previews strength G.
  const anim = recorded && animationPlaneMatches(block, animZ) ? recorded : null;
  const barKind: 'spl' | 'field' = choice === 'spl' || (choice === 'field' && onDemand && !anim) ? 'spl' : 'field';
  const defaultRange = barKind === 'spl' && sourceId ? splDisplayRange(block, splMap, sourceId) : null;
  const range = applyLegendBounds(defaultRange, ownOverlay?.legend);
  const legendEdited = !!defaultRange && !!range && (range.min !== defaultRange.min || range.max !== defaultRange.max);
  const loading = !!sourceId && field.pending.some((k) => k.endsWith(`:${sourceId}`));
  const frameIndex = anim ? Math.min(frame, anim.frames - 1) : 0;
  const volume = choice === 'spl' ? block.volume ?? null : null;
  const slice = volume ? ownOverlay?.slice ?? defaultSlice(block, volume) : null;
  const sliceRange = volume && slice ? volumeAxisRange(volume, slice.axis) : null;

  const overlayOptions = [
    { value: 'none', label: 'None' },
    { value: 'spl', label: 'SPL map (strength G)' },
    ...(fieldSources.length > 0 ? [{ value: 'field', label: 'Wave animation' }] : []),
  ];
  const sourceOptions = choice === 'field'
    ? fieldSources.map((s) => ({ value: s.source_id, label: nameOf(s.source_id) }))
    : [
        ...(block.sources.length > 1 ? [{ value: PFFDTD_ALL_SOURCES, label: 'All sources (energy sum)' }] : []),
        ...block.sources.map((s) => ({ value: s.source_id, label: nameOf(s.source_id) })),
      ];

  return (
    <div className="card-stack--md">
      <div className="flex items-center gap-2">
        <span className="text-[10px] shrink-0" style={mutedStyle}>Field</span>
        <CardSelect
          value={choice}
          onChange={(v) => select(v as OverlayChoice)}
          compact
          className="flex-1"
          options={overlayOptions}
        />
      </div>

      {choice !== 'none' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] shrink-0" style={mutedStyle}>Source</span>
          <CardSelect
            value={sourceId ?? ''}
            onChange={(v) => select(choice, v)}
            compact
            className="flex-1"
            options={sourceOptions}
          />
        </div>
      )}

      {choice === 'field' && onDemand && block.volume && (
        <PffdtdAnimationGenerator
          configId={configId}
          simulationId={simulationId}
          block={block}
          volume={block.volume}
          z={animZ}
          hasAnimation={animatedSources.length > 0}
          onBlueBackground={onBlueBackground}
        />
      )}

      {volume && slice && sliceRange && (
        <div className="card-stack--tight">
          <div className="flex items-center gap-2">
            <span className="text-[10px] shrink-0" style={mutedStyle}>Slice</span>
            <CardSelect
              value={slice.axis}
              onChange={(v) => {
                const axis = v as PffdtdSliceAxis;
                setFieldSlice(configId, { axis, position: defaultSlicePosition(block, volume, axis) });
              }}
              compact
              className="flex-1"
              options={SLICE_AXIS_OPTIONS}
            />
          </div>
          <RangeSlider
            label={SLICE_POSITION_LABEL[slice.axis]}
            value={slice.position}
            min={sliceRange.min}
            max={sliceRange.max}
            step={PFFDTD_VISUALS.SLICE_STEP_M}
            unit="m"
            precision={2}
            defaultValue={defaultSlicePosition(block, volume, slice.axis)}
            onChange={(position) => setFieldSlice(configId, { axis: slice.axis, position })}
            onBlueBackground={onBlueBackground}
          />
        </div>
      )}

      {choice !== 'none' && (
        <div className="card-stack--tight">
          <div
            className="h-3.5 w-full rounded"
            style={{ background: barKind === 'spl' ? SEQUENTIAL_CSS_GRADIENT : DIVERGING_CSS_GRADIENT }}
          />
          <div className="flex items-end justify-between gap-1 text-[9px]" style={mutedStyle}>
            {barKind === 'spl' ? (
              <>
                {range ? (
                  <LegendBoundField
                    label="Colour-bar minimum"
                    value={range.min}
                    onChange={(min) => setFieldLegend(configId, { min, max: range.max })}
                    onBlueBackground={onBlueBackground}
                  />
                ) : <span>–</span>}
                <span className="self-end pb-0.5">
                  G re {block.reference.replace(/^G re /, '')}
                  {legendEdited && (
                    <button
                      type="button"
                      onClick={() => setFieldLegend(configId, null)}
                      className="ml-1 cursor-pointer underline"
                      title="Back to the map's own min / max"
                    >
                      reset
                    </button>
                  )}
                </span>
                {range ? (
                  <LegendBoundField
                    label="Colour-bar maximum"
                    value={range.max}
                    onChange={(max) => setFieldLegend(configId, { min: range.min, max })}
                    onBlueBackground={onBlueBackground}
                  />
                ) : <span>–</span>}
              </>
            ) : (
              <>
                <span>−{anim?.vmax.toPrecision(2) ?? ''}</span>
                <span>pressure (relative)</span>
                <span>+{anim?.vmax.toPrecision(2) ?? ''}</span>
              </>
            )}
          </div>
          <span className="text-[9px]" style={mutedStyle}>
            {slice
              ? `Slice ${slice.axis} = ${slice.position.toFixed(2)} m`
              : barKind === 'spl' && choice === 'field'
                ? `Strength G at z = ${animZ.toFixed(2)} m (preview)`
                : `Plane z = ${block.z.toFixed(2)} m`}
            {' '}· band {block.band_hz[0].toFixed(0)}–{block.band_hz[1].toFixed(0)} Hz
            {loading ? ' · loading…' : ''}
          </span>
        </div>
      )}

      {anim && (
        <div className="card-stack--tight">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPlaying(!playing)}
              className="flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded-full border transition-colors"
              style={{ borderColor: 'currentColor', ...mutedStyle }}
              title={playing ? 'Pause' : 'Play'}
              aria-label={playing ? 'Pause animation' : 'Play animation'}
            >
              {playing ? <Pause size={11} /> : <Play size={11} />}
            </button>
            <span className="flex-1 text-[10px] tabular-nums" style={mutedStyle}>
              t = {(anim.times_ms[frameIndex] ?? 0).toFixed(1)} ms
            </span>
            <CardSelect
              value={String(fps)}
              onChange={(v) => setFps(Number(v))}
              compact
              fitContent
              options={PFFDTD_VISUALS.FPS_OPTIONS.map((f) => ({ value: String(f), label: `${f} fps` }))}
            />
          </div>
          <RangeSlider
            label="Frame"
            value={frameIndex}
            min={0}
            max={Math.max(0, anim.frames - 1)}
            step={1}
            onChange={(v) => { setPlaying(false); setFrame(v); }}
            onBlueBackground={onBlueBackground}
          />
        </div>
      )}
    </div>
  );
}
