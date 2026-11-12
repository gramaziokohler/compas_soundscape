/**
 * AcousticPathsPanel — "Sound paths" of a geometric card: trace and inspect how sound travels.
 *
 * - Reflections: the image-source paths of every source-listener pair, coloured by order,
 *   filtered by order, arrival time and pair.
 * - Billiard: rays leaving each source, animated in slow motion with a scrubber.
 * - Diffraction: the edges sound bends around. Edges carrying a path are highlighted; an edge
 *   can be switched off (it then does not diffract in the simulation) by clicking it in the 3D
 *   view or with the bulk buttons. The switched-off edges are a setting of the card.
 *
 * The trace runs on the same geometry inputs as the simulation and turns "outdated" when they
 * change, like the geometry check.
 */

'use client';

import { useEffect, useMemo } from 'react';
import { Pause, Play } from 'lucide-react';
import { useAcousticPathsStore } from '@/store';
import { Badge } from '@/components/ui/Badge';
import { CardSelect } from '@/components/ui/CardSelect';
import { Checkbox } from '@/components/ui/Checkbox';
import { Notice } from '@/components/ui/Notice';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { ToggleField } from '@/components/ui/ToggleField';
import { ACOUSTIC_PATHS, GA_ENGINE } from '@/utils/constants';
import { pathCounts } from '@/lib/acoustics/acoustic-paths';
import { sameEdge } from '@/lib/acoustics/geometric-engine';
import type { AcousticPathKind, AcousticPathsView } from '@/types/acousticPaths';

/** Wiring provided by the simulation card (AcousticsSection). */
export interface AcousticPathsControl {
  /** Input signature of the card right now (compared with the trace's). */
  currentSignature: string | null;
  onRun: () => void;
  disabled?: boolean;
  /** Why tracing is unavailable (legacy engine, missing install), shown instead of the button. */
  unavailableReason?: string | null;
}

interface AcousticPathsPanelProps extends AcousticPathsControl {
  configId: string;
  /** The card's switched-off edges and diffraction model. */
  excludedEdges: number[][];
  diffraction: string;
  onExcludedEdgesChange: (edges: number[][]) => void;
  /** Read-only cards (share view) inspect but do not edit edges. */
  canEdit: boolean;
}

const KINDS: { kind: AcousticPathKind; label: string; title: string }[] = [
  { kind: 'reflections', label: 'Reflections', title: 'Image-source paths between every source and listener' },
  { kind: 'diffraction', label: 'Diffraction', title: 'Diffracting edges and the paths bending around them' },
  { kind: 'rays', label: 'Billiard', title: 'Rays leaving each source, animated in slow motion' },
];

const LINK_BUTTON =
  'cursor-pointer text-xxs text-secondary-hover underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50';

function ViewCheck({ field, label, colorVar }: { field: keyof AcousticPathsView; label: string; colorVar?: string }) {
  const checked = useAcousticPathsStore((s) => !!s.view[field]);
  const setView = useAcousticPathsStore((s) => s.setView);
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xxs">
      <Checkbox
        checked={checked}
        onChange={(on) => setView({ [field]: on } as Partial<AcousticPathsView>)}
        size={12}
        label={label}
        accentColor={colorVar ? `var(${colorVar})` : undefined}
      />
      {label}
    </label>
  );
}

export function AcousticPathsPanel({
  configId,
  currentSignature,
  onRun,
  disabled = false,
  unavailableReason = null,
  excludedEdges,
  diffraction,
  onExcludedEdgesChange,
  canEdit,
}: AcousticPathsPanelProps) {
  const entry = useAcousticPathsStore((s) => s.entries[configId]);
  const previewConfigId = useAcousticPathsStore((s) => s.previewConfigId);
  const options = useAcousticPathsStore((s) => s.options);
  const view = useAcousticPathsStore((s) => s.view);
  const playing = useAcousticPathsStore((s) => s.playing);
  const speed = useAcousticPathsStore((s) => s.speed);
  const timeMs = useAcousticPathsStore((s) => s.timeMs);
  const durationMs = useAcousticPathsStore((s) => s.durationMs);
  const edgeEditing = useAcousticPathsStore((s) => s.edgeEditing);
  const store = useAcousticPathsStore.getState;

  const isRunning = entry?.status === 'running';
  const payload = entry?.status === 'done' ? entry.payload : null;
  const isStale = !!payload && !!currentSignature && entry?.signature !== currentSignature;
  const isPreviewed = previewConfigId === configId;
  const counts = useMemo(() => pathCounts(payload), [payload]);
  const edges = payload?.diffraction?.edges ?? [];
  const excludedCount = edges.filter((e) => excludedEdges.some((x) => sameEdge(x, e.segment))).length;
  const diffractionOff = diffraction === GA_ENGINE.DIFFRACTION_OFF;

  // Hide this card's paths when the card unmounts (collapsed / removed).
  useEffect(() => () => {
    const s = useAcousticPathsStore.getState();
    if (s.previewConfigId === configId) s.setPreviewConfig(null);
  }, [configId]);

  const pairOptions = (items: { id: string }[], all: string) => [
    { value: '', label: all },
    ...items.map((item) => ({ value: item.id, label: item.id })),
  ];

  return (
    <div className="card-stack--md">
      <div className="flex items-center gap-1.5">
        <span className="text-xxs text-secondary-hover">Sound paths</span>
        {payload && isStale && <Badge title="Inputs changed since the last trace">outdated</Badge>}
        {excludedEdges.length > 0 && (
          <Badge variant="warning" title="Diffraction edges switched off for this card">
            {excludedEdges.length} edge{excludedEdges.length > 1 ? 's' : ''} off
          </Badge>
        )}
        <span className="flex-1" />
        {!unavailableReason && (
          <button
            type="button"
            disabled={disabled || (!isRunning && options.kinds.length === 0)}
            title={!isRunning && options.kinds.length === 0 ? 'Pick at least one kind of path to trace' : undefined}
            onClick={() => (isRunning ? store().cancelPaths(configId) : onRun())}
            className="cursor-pointer rounded border border-primary bg-transparent px-2 text-xxs font-semibold leading-4 text-primary transition-colors hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRunning ? 'Cancel' : payload ? 'Re-trace' : 'Trace paths'}
          </button>
        )}
      </div>

      {unavailableReason && <p className="text-xxs text-secondary-hover">{unavailableReason}</p>}

      {!unavailableReason && (
        <>
          {/* What to trace */}
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {KINDS.map(({ kind, label, title }) => (
              <label key={kind} className="flex cursor-pointer items-center gap-1.5 text-xxs" title={title}>
                <Checkbox
                  checked={options.kinds.includes(kind)}
                  onChange={() => store().toggleKind(kind)}
                  size={12}
                  label={label}
                  disabled={isRunning}
                />
                {label}
              </label>
            ))}
          </div>
          {options.kinds.includes('reflections') && (
            <RangeSlider
              label="Reflection order to trace"
              value={options.maxOrder}
              min={0}
              max={ACOUSTIC_PATHS.REFLECTION_ORDER_MAX}
              step={1}
              onChange={(v) => store().setOptions({ maxOrder: v })}
              disabled={isRunning}
              defaultValue={ACOUSTIC_PATHS.REFLECTION_ORDER_DEFAULT}
              hoverText="Higher orders take much longer on models with many walls"
            />
          )}
          {options.kinds.includes('rays') && (
            <div className="card-stack--tight">
              <RangeSlider
                label="Rays per source"
                value={options.nRays}
                min={ACOUSTIC_PATHS.RAYS_MIN}
                max={ACOUSTIC_PATHS.RAYS_MAX}
                step={ACOUSTIC_PATHS.RAYS_STEP}
                onChange={(v) => store().setOptions({ nRays: v })}
                disabled={isRunning}
                defaultValue={ACOUSTIC_PATHS.RAYS_DEFAULT}
              />
              <RangeSlider
                label="Bounces per ray"
                value={options.rayOrder}
                min={0}
                max={ACOUSTIC_PATHS.RAY_ORDER_MAX}
                step={1}
                onChange={(v) => store().setOptions({ rayOrder: v })}
                disabled={isRunning}
                defaultValue={ACOUSTIC_PATHS.RAY_ORDER_DEFAULT}
              />
            </div>
          )}
        </>
      )}

      {isRunning && (
        <div className="card-field">
          <ProgressBar value={(entry?.progress ?? 0) / 100} label="Sound paths" />
          <span className="text-xxs text-secondary-hover">{entry?.statusText}</span>
        </div>
      )}
      {entry?.status === 'error' && entry.error && <Notice type="error" message={entry.error} />}

      {payload && (
        <>
          <span className="text-xxs text-secondary-hover">
            {[
              payload.reflections && `${counts.reflections.toLocaleString()} reflection paths`,
              payload.diffraction && `${counts.edges} edges (${counts.used} carry a path)`,
              payload.diffraction && `${counts.diffracted} diffracted paths`,
              payload.rays && `${counts.rays} rays`,
            ].filter(Boolean).join(' · ')}
          </span>
          {payload.notes.map((note) => <Notice key={note} type="info" message={note} />)}

          <ToggleField
            checked={isPreviewed}
            onChange={(on) => store().setPreviewConfig(on ? configId : null)}
            label="Show paths in 3D"
          />

          {isPreviewed && (
            <div className="card-stack--md">
              {/* Legend = visibility filter, tinted like the 3D lines */}
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {payload.reflections && <ViewCheck field="showReflections" label="Reflections" colorVar={ACOUSTIC_PATHS.COLOR_VARS.ORDERS[0]} />}
                {payload.diffraction && <ViewCheck field="showDiffraction" label="Diffracted paths" colorVar={ACOUSTIC_PATHS.COLOR_VARS.DIFFRACTED} />}
                {payload.diffraction && <ViewCheck field="showEdges" label="Edges" colorVar={ACOUSTIC_PATHS.COLOR_VARS.EDGE} />}
                {payload.rays && <ViewCheck field="showRays" label="Billiard" colorVar={ACOUSTIC_PATHS.COLOR_VARS.PARTICLE} />}
              </div>

              {(payload.sources.length > 1 || payload.receivers.length > 1) && (
                <div className="card-stack--tight">
                  {payload.sources.length > 1 && (
                    <CardSelect
                      compact
                      value={view.sourceId ?? ''}
                      onChange={(v) => store().setView({ sourceId: v || null })}
                      options={pairOptions(payload.sources, 'All sources')}
                    />
                  )}
                  {payload.receivers.length > 1 && (
                    <CardSelect
                      compact
                      value={view.receiverId ?? ''}
                      onChange={(v) => store().setView({ receiverId: v || null })}
                      options={pairOptions(payload.receivers, 'All listeners')}
                    />
                  )}
                </div>
              )}

              {payload.reflections && view.showReflections && (
                <div className="card-stack--tight">
                  <RangeSlider
                    label="Show up to order"
                    value={Math.min(view.maxOrder, payload.reflections.max_order)}
                    min={0}
                    max={Math.max(payload.reflections.max_order, 1)}
                    step={1}
                    onChange={(v) => store().setView({ maxOrder: v })}
                  />
                  <ToggleField
                    checked={view.timeWindowMs !== null}
                    onChange={(on) => store().setView({ timeWindowMs: on ? 50 : null })}
                    label="Only early arrivals"
                  />
                  {view.timeWindowMs !== null && (
                    <RangeSlider
                      label="After the first arrival"
                      unit="ms"
                      value={view.timeWindowMs}
                      min={1}
                      max={200}
                      step={1}
                      onChange={(v) => store().setView({ timeWindowMs: v })}
                      hoverText="50 ms: what fuses with the direct sound; 80 ms: the clarity window"
                    />
                  )}
                </div>
              )}

              {/* Billiard transport */}
              {payload.rays && view.showRays && (
                <div className="card-stack--tight">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={playing ? 'Pause the billiard' : 'Play the billiard'}
                      onClick={() => store().setPlaying(!playing)}
                      className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border border-primary text-primary transition-colors hover:bg-primary hover:text-white"
                    >
                      {playing ? <Pause size={10} /> : <Play size={10} />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <RangeSlider
                        label="Time"
                        unit="ms"
                        precision={1}
                        value={Math.min(timeMs, Math.max(durationMs, 0))}
                        min={0}
                        max={Math.max(Math.ceil(durationMs), 1)}
                        step={0.5}
                        onChange={(v) => store().seek(v)}
                        onDragStart={() => store().setPlaying(false)}
                      />
                    </div>
                  </div>
                  <CardSelect
                    compact
                    value={String(speed)}
                    onChange={(v) => store().setSpeed(Number(v))}
                    options={ACOUSTIC_PATHS.PLAYBACK_SPEEDS.map((s) => ({
                      value: String(s),
                      label: `${Math.round(1 / s)}× slower`,
                      title: `1 s of sound takes ${Math.round(1 / s)} s`,
                    }))}
                  />
                </div>
              )}

              {/* Diffraction edges: inspect and select */}
              {payload.diffraction && view.showEdges && (
                <div className="card-stack--tight">
                  <span className="text-xxs text-secondary-hover">
                    {edges.length - excludedCount} of {edges.length} edges on
                    {diffractionOff && ' — edge diffraction is off for this card'}
                  </span>
                  <ViewCheck field="obstacleEdgesOnly" label="Hide room-corner edges" />
                  {canEdit && (
                    <>
                      <ToggleField
                        checked={edgeEditing}
                        onChange={(on) => store().setEdgeEditing(on)}
                        label="Click edges in 3D to switch them off / on"
                      />
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        <button type="button" className={LINK_BUTTON} disabled={excludedEdges.length === 0}
                          onClick={() => onExcludedEdgesChange([])}>
                          All on
                        </button>
                        <button type="button" className={LINK_BUTTON}
                          onClick={() => onExcludedEdgesChange(edges.map((e) => e.segment))}>
                          All off
                        </button>
                        <button type="button" className={LINK_BUTTON} title="Keep only the edges a diffracted path passes over"
                          onClick={() => onExcludedEdgesChange(edges.filter((e) => !e.used).map((e) => e.segment))}>
                          Only edges with a path
                        </button>
                        <button type="button" className={LINK_BUTTON} title="Keep only the edges of objects inside the room"
                          onClick={() => onExcludedEdgesChange(edges.filter((e) => e.kind === 'boundary').map((e) => e.segment))}>
                          Only obstacle edges
                        </button>
                      </div>
                    </>
                  )}
                  <p className="text-xxs text-secondary-hover">
                    Orange: diffracting. Red: a path of the current sources and listeners passes over it. Grey dashed: off.
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
