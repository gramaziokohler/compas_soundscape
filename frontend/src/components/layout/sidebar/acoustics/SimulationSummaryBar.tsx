/**
 * SimulationSummaryBar Component
 *
 * Three source / listener / material count dots stacked in the simulation card
 * footer, to the left of the Start Simulation button. Each idle dot is a circle
 * showing only the number; hovering (or keyboard-focusing) expands that dot
 * into the full `{count} {label}` chip.
 *
 * - **sources**  : unique sound-source positions actually simulated (muted sounds
 *   are excluded, sounds sharing a position count as one, and multi-variant
 *   sources collapse to one). Replicates the sim's `activeSoundscapeData`.
 * - **listeners** : total individual listener points (single listeners + grid
 *   listener points), excluding listeners hidden for simulation.
 * - **materials** : count of distinct materials currently assigned (ObjectExplorer /
 *   acousticMaterialStore-driven).
 *
 * Each item is colored `--color-error` when its count is 0 and primary when > 0.
 * Clicking an item navigates to the relevant section (expanding the left sidebar /
 * right sidebar / Object Explorer panel as needed) and plays a transient
 * SectionHighlight border.
 *
 * Usage:
 * ```tsx
 * <Card footerPrefix={<SimulationSummaryBar />} ... />
 * ```
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
  useSpeckleStore,
  useUIStore,
} from '@/store';
import { collapseVariantsToOne, groupSoundsByPosition } from '@/utils/positionKey';
import { SectionHighlight } from '@/components/ui/SectionHighlight';

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
    const { viewMode, setViewMode } = useSpeckleStore.getState();
    if (viewMode !== 'acoustic') {
      setViewMode('acoustic');
    }
    useUIStore.getState().setShowObjectExplorer(true);
    runHighlight('materials');
  };

  return (
    <>
      {/* Direct flex child of the card footer: stretch to the Start Simulation
          button height, then split that height across three equal rows. */}
      <div
        className="grid grid-rows-3 gap-px self-stretch select-none"
        onClick={(e) => e.stopPropagation()}
      >
        <SummaryChip count={sourceCount} label="source" onClick={handleSources} />
        <SummaryChip count={listenerCount} label="listener" onClick={handleListeners} />
        <SummaryChip count={materialCount} label="material" onClick={handleMaterials} />
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
  const hasItems = count > 0;
  const pluralLabel = count === 1 ? label : `${label}s`;
  const fullLabel = `${count} ${pluralLabel}`;
  const fillClass = hasItems ? 'bg-primary text-white' : 'bg-error text-white';
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="relative h-full min-h-[8px] min-w-[8px] aspect-square justify-self-start">
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        onFocus={() => setExpanded(true)}
        onBlur={() => setExpanded(false)}
        aria-label={fullLabel}
        className={`flex items-center rounded-full font-medium leading-none cursor-pointer ${fillClass} ${
          expanded
            ? 'absolute left-0 top-1/2 z-20 h-auto w-max -translate-y-1/2 px-2 py-0.5 text-[10.5px]'
            : 'h-full w-full justify-center text-[7px]'
        }`}
      >
        <span className="tabular-nums">{count}</span>
        {expanded && <span className="pl-1 whitespace-nowrap">{pluralLabel}</span>}
      </button>
    </div>
  );
}
