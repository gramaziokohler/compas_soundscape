/**
 * SimulationSummaryBar Component
 *
 * One-line summary shown at the top of a Choras / Pyroomacoustics simulation card.
 * Displays, in order: `N source(s) | N listener(s) | N material(s)`. Labels are
 * singular unless the count is > 1.
 *
 * - **sources**  : unique sound-source positions actually simulated (muted sounds
 *   are excluded, sounds sharing a position count as one, and multi-variant
 *   sources collapse to one). Replicates the sim's `activeSoundscapeData`.
 * - **listeners** : total individual listener points (single listeners + grid
 *   listener points), excluding listeners hidden for simulation.
 * - **materials** : count of distinct materials currently assigned (ObjectExplorer /
 *   acousticMaterialStore-driven).
 *
 * Each item is colored `--color-error` when its count is 0 and
 * `var(--card-color, var(--color-primary))` when > 0. Clicking an item navigates
 * to the relevant section (expanding the left sidebar / right sidebar / Object
 * Explorer panel as needed) and plays a transient SectionHighlight border.
 *
 * The line ALWAYS fits its container width via CSS container query units: the
 * wrapper is an inline-size query container and the row's font-size is
 * `clamp(7px, 4.5cqw, 12px)`. Text scales proportionally with the container, so
 * it grows/shrinks live with the layout and can never overflow or get stuck at a
 * stale scale (no JS measurement state). 4.5cqw is sized for worst-case
 * three-digit counts; for typical counts it simply caps at 12px.
 */

'use client';

import { useMemo, useState } from 'react';
import {
  useAcousticMaterialStore,
  useAudioControlsStore,
  useGridListenersStore,
  useReceiversStore,
  useRightSidebarStore,
  useSoundscapeStore,
  useUIStore,
} from '@/store';
import { collapseVariantsToOne, groupSoundsByPosition } from '@/utils/positionKey';
import { SectionHighlight } from '@/components/ui/SectionHighlight';
import { Badge } from '@/components/ui/Badge';

const HIGHLIGHT_TARGETS = {
  sources: 'sidebar-sounds-breadcrumb',
  listeners: 'listeners-section',
  materials: 'object-explorer-panel',
} as const;

type HighlightKey = keyof typeof HIGHLIGHT_TARGETS;

export function SimulationSummaryBar() {
  const soundscapeData = useSoundscapeStore((s) => s.soundscapeData);
  const soundConfigs = useSoundscapeStore((s) => s.soundConfigs);
  const mutedSounds = useAudioControlsStore((s) => s.mutedSounds);
  const selectedVariants = useAudioControlsStore((s) => s.selectedVariants);
  const activeSoundParentIndex = useUIStore((s) => s.activeSoundParentIndex);
  const isInSoundsStep = useUIStore((s) => s.isInSoundsStep);
  const receivers = useReceiversStore((s) => s.receivers);
  const gridListeners = useGridListenersStore((s) => s.gridListeners);
  const materialAssignments = useAcousticMaterialStore((s) => s.materialAssignments);

  const [highlight, setHighlight] = useState<{ key: HighlightKey; trigger: number } | null>(null);

  // Mirrors AcousticsSection.activeSoundscapeData so the count matches the sim.
  const activeSoundscapeData = useMemo(() => {
    const unmuted = (soundscapeData ?? []).filter((s) => !mutedSounds.has(s.id));
    if (activeSoundParentIndex === null || activeSoundParentIndex === undefined) {
      return unmuted;
    }
    const matchingPromptIndices = new Set<number>();
    (soundConfigs ?? []).forEach((config, idx) => {
      if (config.parentUsageOriginalIndex === activeSoundParentIndex) {
        matchingPromptIndices.add(idx);
      }
    });
    return unmuted.filter(
      (s) => s.prompt_index !== undefined && matchingPromptIndices.has(s.prompt_index),
    );
  }, [soundscapeData, mutedSounds, activeSoundParentIndex, isInSoundsStep, soundConfigs]);

  const sourceCount = useMemo(() => {
    const { uniquePositions } = groupSoundsByPosition(
      collapseVariantsToOne(activeSoundscapeData, selectedVariants),
    );
    return uniquePositions.size;
  }, [activeSoundscapeData, selectedVariants]);

  const listenerCount = useMemo(() => {
    const singles = receivers.filter((r) => !r.hiddenForSimulation).length;
    const grid = gridListeners
      .filter((g) => !g.hiddenForSimulation)
      .reduce((sum, g) => sum + g.points.length, 0);
    return singles + grid;
  }, [receivers, gridListeners]);

  const materialCount = useMemo(
    () => new Set(Array.from(materialAssignments.values())).size,
    [materialAssignments],
  );

  const runHighlight = (key: HighlightKey) => {
    setHighlight({ key, trigger: (highlight?.trigger ?? 0) + 1 });
  };

  const handleSources = () => {
    useUIStore.getState().setIsLeftSidebarExpanded(true);
    useUIStore.getState().triggerSoundsNav();
    runHighlight('sources');
  };
  const handleListeners = () => {
    useRightSidebarStore.getState().requestExpand();
    runHighlight('listeners');
  };
  const handleMaterials = () => {
    useUIStore.getState().setShowObjectExplorer(true);
    runHighlight('materials');
  };

  return (
    <>
      {/* Inline-size query container: cqw below scales with THIS element's width,
          so the line always fits no matter the panel/viewport size. */}
      <div className="w-full overflow-hidden" style={{ containerType: 'inline-size' }}>
        <div
          className="flex items-center gap-1 font-medium select-none whitespace-nowrap"
          style={{
            fontSize: 'clamp(7px, 5.5cqw, 12px)',
            lineHeight: 1.15,
            minHeight: '1.05rem',
          }}
        >
          <SummaryChip count={sourceCount} label="source" onClick={handleSources} />
          <span className="text-secondary-hover" aria-hidden="true">
            |
          </span>
          <SummaryChip count={listenerCount} label="listener" onClick={handleListeners} />
          <span className="text-secondary-hover" aria-hidden="true">
            |
          </span>
          <SummaryChip count={materialCount} label="material" onClick={handleMaterials} />
        </div>
      </div>
      {highlight && (
        <SectionHighlight
          targetId={HIGHLIGHT_TARGETS[highlight.key]}
          trigger={highlight.trigger}
        />
      )}
    </>
  );
}

interface SummaryChipProps {
  count: number;
  label: string;
  onClick: () => void;
}

function SummaryChip({ count, label, onClick }: SummaryChipProps) {
  return (
    <Badge
      size="sm"
      variant={count > 0 ? 'primary' : 'error'}
      onClick={onClick}
      className="hover:underline"
    >
      <span className="tabular-nums">{count}</span>&nbsp;{count > 1 ? `${label}s` : label}
    </Badge>
  );
}
