'use client';

import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import type {
  AnalysisConfig,
  AnalysisResult,
  TextAnalysisConfig,
  ScenarioConfig,
  AnalysisBaseConfig,
} from '@/types/analysis';
import type { CardTypeOption } from '@/components/ui/CardSection';
import { CARD_TYPE_LABELS } from '@/types/card';
import type { CardType } from '@/types/card';
import { CardSection } from '@/components/ui/CardSection';
import { Card } from '@/components/ui/Card';
import { TextContextContent } from '@/components/layout/sidebar/analysis/TextContextContent';
import { ScenarioContent } from '@/components/layout/sidebar/analysis/ScenarioContent';
import { ScenarioAfterView, getScenarioPipelineStatus } from '@/components/layout/sidebar/analysis/ScenarioContent';
import { AnalysisResultContent } from '@/components/layout/sidebar/analysis/AnalysisResultContent';
import { useAnalysisStore, useSoundscapeStore, useAreaDrawingStore } from '@/store';
import { useServiceVersions } from '@/hooks/useServiceVersions';
import { LLM_MODEL_TO_PROVIDER } from '@/utils/constants';
import type { CustomMenuItem } from '@/types/card';
import { CircularFAB } from '@/components/ui/CircularFAB';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface UsageSectionProps {
  /** Full analysisConfigs array — section filters internally to usage types */
  analysisConfigs: AnalysisConfig[];
  isRunning: boolean;
  error: string | null;
  analysisResult: AnalysisResult[];
  hasGlobalModelLoaded?: boolean;
  onAddConfig: (type: CardType) => void;
  onRemoveConfig: (index: number) => void;
  onUpdateConfig: (index: number, updates: Partial<AnalysisConfig>) => void;
  onRun: (index: number) => void;
  onStop: () => void;
  onReset: (index: number) => void;
  onTogglePromptSelection: (configIndex: number, promptId: string) => void;
  onSendToSoundGeneration: () => void;
  /** Send selected prompts AND advance to step 2 (Sounds). Receives original card index and title. */
  onAdvanceToSounds: (originalIndex: number, title: string) => void;
  /** Controlled expanded original index in analysisConfigs */
  expandedOriginalIndex?: number | null;
  /** Called when the expanded card changes (original index, or null if collapsed) */
  onExpandedOriginalIndexChange?: (originalIndex: number | null) => void;
  /** When set, only show usage cards whose parentContextOriginalIndex matches this value */
  activeContextOriginalIndex?: number | null;
}

const USAGE_CARD_TYPES: CardType[] = ['scenario', 'text', 'freeform'];

// ─── Component ────────────────────────────────────────────────────────────────

export function UsageSection({
  analysisConfigs = [],
  isRunning,
  error,
  analysisResult = [],
  onAddConfig,
  onRemoveConfig,
  onUpdateConfig,
  onRun,
  onStop,
  onReset,
  onTogglePromptSelection,
  onSendToSoundGeneration,
  onAdvanceToSounds,
  expandedOriginalIndex,
  onExpandedOriginalIndexChange,
  activeContextOriginalIndex,
}: UsageSectionProps) {
  // Controlled expansion state: filtered index within usageConfigs
  const [filteredExpandedIndex, setFilteredExpandedIndex] = useState<number | null>(null);
  const serviceVersions = useServiceVersions();
  const llmModel = useSoundscapeStore((s) => s.llmModel);
  const soundConfigs = useSoundscapeStore((s) => s.soundConfigs);
  const analysisStatus = useAnalysisStore((s) => s.analysisStatus);
  const analyzingConfigIndex = useAnalysisStore((s) => s.analyzingConfigIndex);
  const handleReorderConfigs = useAnalysisStore((s) => s.handleReorderConfigs);
  const duplicateConfigAt = useAnalysisStore((s) => s.duplicateConfigAt);
  const areaDrawing = useAreaDrawingStore();

  // Filter to usage card types only, then by active parent context if set
  // Freeform cards without parentContextOriginalIndex belong to Context, exclude them here.
  const usageConfigs = useMemo(
    () => analysisConfigs.filter((c) => {
      if (!USAGE_CARD_TYPES.includes(c.type as CardType)) return false;
      if (c.type === 'freeform' && (c as AnalysisBaseConfig).parentContextOriginalIndex === undefined) return false;
      if (activeContextOriginalIndex !== null && activeContextOriginalIndex !== undefined) {
        return (c as AnalysisBaseConfig).parentContextOriginalIndex === activeContextOriginalIndex;
      }
      return true;
    }),
    [analysisConfigs, activeContextOriginalIndex],
  );

  // Map from filtered index → original index in analysisConfigs
  const indexMap = useMemo(
    () => usageConfigs.map((uc) => analysisConfigs.indexOf(uc)),
    [usageConfigs, analysisConfigs],
  );

  // Sync controlled expandedOriginalIndex → filtered index for CardSection
  useEffect(() => {
    if (expandedOriginalIndex === undefined) return;
    if (expandedOriginalIndex === null) {
      setFilteredExpandedIndex(null);
    } else {
      const fi = indexMap.indexOf(expandedOriginalIndex);
      setFilteredExpandedIndex(fi >= 0 ? fi : null);
    }
  }, [expandedOriginalIndex, indexMap]);

  // Auto-expand newly added usage cards; auto-advance for freeform cards
  // Initialize to current length so existing cards don't re-trigger auto-advance on remount
  const prevUsageLength = useRef(usageConfigs.length);
  useEffect(() => {
    if (usageConfigs.length > prevUsageLength.current) {
      const lastFi = usageConfigs.length - 1;
      const originalIndex = indexMap[lastFi];
      const newConfig = usageConfigs[lastFi];

      if (newConfig?.type === 'freeform') {
        // Skip expansion — jump straight to Sounds step
        const name = newConfig.display_name || 'Untitled usage';
        if (originalIndex !== undefined) onAdvanceToSounds(originalIndex, name);
      } else {
        setFilteredExpandedIndex(lastFi);
        if (originalIndex !== undefined) onExpandedOriginalIndexChange?.(originalIndex);
      }
    }
    prevUsageLength.current = usageConfigs.length;
  }, [usageConfigs.length, indexMap, onExpandedOriginalIndexChange, onAdvanceToSounds]);

  const handleCardSectionExpandedChange = useCallback(
    (fi: number | null) => {
      setFilteredExpandedIndex(fi);
      const originalIndex = fi !== null ? (indexMap[fi] ?? null) : null;
      onExpandedOriginalIndexChange?.(originalIndex);
    },
    [indexMap, onExpandedOriginalIndexChange],
  );

  // Track scenario cards pending auto-send (foley started, waiting for completion)
  const pendingAutoSendRef = useRef<Set<number>>(new Set());

  // When foleyResult arrives for a pending scenario, auto-send and advance
  useEffect(() => {
    const pending = pendingAutoSendRef.current;
    if (pending.size === 0) return;
    for (const originalIndex of [...pending]) {
      const config = analysisConfigs[originalIndex];
      if (config?.type !== 'scenario') continue;
      const sc = config as ScenarioConfig;
      if (!sc.foleyResult) continue;
      // Wait until foley streaming finishes — foleyResult is set incrementally during streaming
      if (isRunning && analyzingConfigIndex === originalIndex) {
        console.log('[UsageSection] Foley streaming in progress for config', originalIndex, '— deferring auto-send');
        continue;
      }
      pending.delete(originalIndex);
      const soundCount = sc.foleyResult.scenarios.reduce((t, s) => t + s.sound_events.length, 0);
      console.log('[UsageSection] Auto-advancing to Sounds for config', originalIndex, 'with', soundCount, 'sounds, selectedKeys:', sc.selectedFoleyKeys?.length ?? 0);
      const scenarioTitle =
        sc.scenarioResult?.scenarios?.[0]?.title ||
        config.display_name ||
        CARD_TYPE_LABELS['scenario'] ||
        'Scenario';
      // onAdvanceToSounds → handleUsageSendToSounds → props.onSendToSoundGeneration(originalIndex)
      // Do NOT call onSendToSoundGeneration() separately — it would push all configs unfiltered
      onAdvanceToSounds(originalIndex, scenarioTitle);
    }
  }, [analysisConfigs, isRunning, analyzingConfigIndex, onAdvanceToSounds]);

  // Check if config has result (for floating action visibility)
  // afterContent for cards
  const getAfterContent = useCallback(
    (config: AnalysisConfig, originalIndex: number) => {
      if (config.type === 'scenario') {
        const sc = config as ScenarioConfig;
        if (sc.scenarioResult || sc.foleyResult) {
          return <ScenarioAfterView config={sc} index={originalIndex} />;
        }
        return null;
      }
      // Text cards: show analysis result prompts if any
      const result = analysisResult.find((r) => r.configIndex === originalIndex);
      if (!result) return null;
      return (
        <AnalysisResultContent
          analysisResult={result}
          onTogglePromptSelection={onTogglePromptSelection}
        />
      );
    },
    [analysisResult],
  );

  const hasResult = useCallback(
    (originalIndex: number): boolean => {
      const config = analysisConfigs[originalIndex];
      if (config?.type === 'scenario') {
        // For scenario: "has result" means scenarioResult exists (either foley or scenario done)
        return (config as ScenarioConfig).scenarioResult !== null;
      }
      return analysisResult.some((r) => r.configIndex === originalIndex);
    },
    [analysisResult, analysisConfigs],
  );

  const getCollapsedInfo = useCallback(
    (config: AnalysisConfig, originalIndex: number): string => {
      if (config.type === 'scenario') {
        const sc = config as ScenarioConfig;
        if (sc.foleyResult) {
          const n = sc.foleyResult.scenarios.reduce(
            (t, s) => t + s.sound_events.length,
            0,
          );
          return `(${n} foley sound${n !== 1 ? 's' : ''})`;
        }
        if (sc.scenarioResult) return '(scenario generated)';
        return '';
      }
      const result = analysisResult.find((r) => r.configIndex === originalIndex);
      if (result) {
        const selectedCount = result.prompts.filter((p) => p.selected).length;
        return `(${selectedCount} selected prompt${selectedCount !== 1 ? 's' : ''})`;
      }
      return '';
    },
    [analysisResult],
  );

  // Wrap onAddConfig to tag new cards with the active parent context index
  const handleAddConfig = useCallback((type: CardType) => {
    const nextIndex = analysisConfigs.length; // new card will be appended at this index
    onAddConfig(type);
    if (type === 'freeform') {
      onUpdateConfig(nextIndex, { display_name: 'Untitled usage' } as Partial<AnalysisConfig>);
    }
    if (activeContextOriginalIndex !== null && activeContextOriginalIndex !== undefined) {
      onUpdateConfig(nextIndex, { parentContextOriginalIndex: activeContextOriginalIndex });
    }
  }, [analysisConfigs.length, onAddConfig, onUpdateConfig, activeContextOriginalIndex]);

  const availableTypes: CardTypeOption[] = useMemo(
    () => [
      { type: 'scenario', label: CARD_TYPE_LABELS['scenario'], enabled: true },
      { type: 'text', label: CARD_TYPE_LABELS['text'], enabled: true },
      { type: 'freeform', label: 'Placeholder usage', enabled: true },
    ],
    [],
  );

  const getBeforeContent = useCallback(
    (config: AnalysisConfig, originalIndex: number) => {
      switch (config.type) {
        case 'text':
          return (
            <TextContextContent
              config={config as TextAnalysisConfig}
              index={originalIndex}
              isAnalyzing={isRunning}
              onUpdateConfig={onUpdateConfig}
            />
          );
        case 'scenario':
          return (
            <ScenarioContent
              config={config as ScenarioConfig}
              index={originalIndex}
              isAnalyzing={isRunning && analyzingConfigIndex === originalIndex}
              onUpdateConfig={onUpdateConfig}
            />
          );
        case 'freeform': {
          const childSounds = soundConfigs.filter(
            (s) => s.parentUsageOriginalIndex === originalIndex,
          );
          return (
            <div className="px-1 py-2 text-xs text-secondary-hover space-y-1">
              {childSounds.length === 0 ? (
                <p>No sounds linked. Click &quot;Go to Sounds&quot; to create sounds for this usage.</p>
              ) : (
                <>
                  <p className="font-medium text-foreground mb-1">Linked sounds:</p>
                  <ul className="space-y-0.5">
                    {childSounds.map((s, i) => (
                      <li key={i} className="flex items-center gap-1">
                        <span>•</span>
                        <span>{s.display_name || s.prompt || `Sound ${i + 1}`}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          );
        }
        default:
          return null;
      }
    },
    [isRunning, analyzingConfigIndex, onUpdateConfig, soundConfigs],
  );

  const getCardVersion = useCallback(
    (config: AnalysisConfig): string | undefined => {
      if (!serviceVersions) return undefined;
      if (config.type === 'text' || config.type === 'scenario') {
        const providers = serviceVersions.llm_providers;
        const providerKey = LLM_MODEL_TO_PROVIDER[llmModel] ?? 'google';
        const p = providers?.[providerKey as keyof typeof providers];
        if (!p) return undefined;
        return p.installed
          ? `${p.name} ${p.version ?? ''}`.trim()
          : `${p.name} (not installed)`;
      }
      return undefined;
    },
    [serviceVersions, llmModel],
  );

  const getPendingCount = useCallback(
    (items: AnalysisConfig[]) => items.length - analysisResult.length,
    [analysisResult.length],
  );

  const renderCard = useCallback(
    (
      config: AnalysisConfig,
      filteredIndex: number,
      isExpanded: boolean,
      onToggleExpand: (index: number) => void,
    ) => {
      const originalIndex = indexMap[filteredIndex] ?? filteredIndex;
      const configHasResult = hasResult(originalIndex);
      const scenarioTitle =
        config.type === 'scenario'
          ? (config as ScenarioConfig).scenarioResult?.scenarios?.[0]?.title
          : null;
      const title = config.display_name || scenarioTitle || CARD_TYPE_LABELS[config.type as CardType] || 'Card';

      // Floating action logic per card type
      let showFloatingAction = false;
      let floatingLabel = '';
      let floatingIsLoading = false;
      let handleFloatingAction: () => void = () => {};

      if (config.type === 'scenario') {
        const sc = config as ScenarioConfig;
        const isFoleyLoading =
          isRunning &&
          analyzingConfigIndex === originalIndex &&
          sc.scenarioId !== null &&
          !sc.foleyResult;

        if (sc.foleyResult) {
          // Foley complete → floating action sends to sounds (but wait for streaming to finish)
          const isFoleyStreaming = isRunning && analyzingConfigIndex === originalIndex;
          showFloatingAction = isExpanded;
          floatingIsLoading = isFoleyStreaming;
          floatingLabel = isFoleyStreaming ? 'Generating sounds…' : 'Send to sounds';
          handleFloatingAction = isFoleyStreaming
            ? () => {}
            : () => {
                // onAdvanceToSounds → handleUsageSendToSounds → pushes only this card's sounds
                onAdvanceToSounds(originalIndex, title);
              };
        } else if (sc.scenarioResult) {
          // Scenario generated, no foley yet → floating action runs foley (auto-chains)
          showFloatingAction = isExpanded;
          floatingLabel = 'Call Foley Artist';
          floatingIsLoading = isFoleyLoading;
          handleFloatingAction = () => {
            if (!isFoleyLoading) {
              pendingAutoSendRef.current.add(originalIndex);
              onRun(originalIndex);
            }
          };
        }
      } else if (config.type === 'text') {
        const result = analysisResult.find((r) => r.configIndex === originalIndex);
        showFloatingAction = isExpanded && configHasResult;
        floatingLabel = 'Send to sounds';
        handleFloatingAction = () => {
          // onAdvanceToSounds → handleUsageSendToSounds → pushes only this card's sounds
          onAdvanceToSounds(originalIndex, title);
        };
        // Disable if nothing selected
        if (result && result.prompts.filter((p) => p.selected).length === 0) {
          floatingLabel = 'Select prompts to send';
        }
      } else if (config.type === 'freeform') {
        showFloatingAction = false;
      }

      // Action button for text cards - draw area custom button
      let customButtons: CustomMenuItem[] | undefined;
      if (config.type === 'text') {
        const cardHasArea = areaDrawing.hasArea(originalIndex);
        const isDrawingThis =
          areaDrawing.isDrawing && areaDrawing.drawingCardIndex === originalIndex;
        customButtons = [
          {
            key: 'draw-area',
            icon: (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2l8 5v10l-8 5-8-5V7z" />
              </svg>
            ),
            label: isDrawingThis
              ? 'Cancel drawing'
              : cardHasArea
              ? 'Redraw area'
              : 'Draw area in viewer',
            isActive: isDrawingThis || cardHasArea,
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              if (isDrawingThis) {
                areaDrawing.cancelDrawing();
              } else {
                areaDrawing.startDrawing(originalIndex);
              }
            },
          },
        ];
      }

      // Scenario action button label
      let actionButtonLabel = 'Generate Sound Prompts';
      if (config.type === 'scenario') {
        actionButtonLabel = 'Generate Scenario';
      } else if (config.type === 'freeform') {
        actionButtonLabel = 'Go to Sounds';
      }

      const card = (
        <Card
          config={config}
          index={filteredIndex}
          isExpanded={isExpanded}
          hasResult={configHasResult}
          result={undefined}
          isRunning={isRunning && analyzingConfigIndex === originalIndex}
          status={
            analyzingConfigIndex === originalIndex
              ? config.type === 'scenario'
                ? getScenarioPipelineStatus(config as ScenarioConfig, true).status
                : analysisStatus
              : undefined
          }
          progress={
            config.type === 'scenario'
              ? getScenarioPipelineStatus(config as ScenarioConfig, analyzingConfigIndex === originalIndex).progress
              : 0
          }
          collapsedInfo={getCollapsedInfo(config, originalIndex)}
          defaultName={
            config.type === 'scenario'
              ? ((config as ScenarioConfig).scenarioResult?.scenarios?.[0]?.title ?? undefined)
              : undefined
          }
          showIndex={true}
          canRemove={true}
          closeButtonTitle="Remove"
          resetButtonTitle="Reset to configuration UI"
          onToggleExpand={(i) => onToggleExpand(i)}
          onUpdateConfig={(i, updates) => onUpdateConfig(originalIndex, updates)}
          onRemove={() => onRemoveConfig(originalIndex)}
          onReset={() => onReset(originalIndex)}
          beforeContent={getBeforeContent(config, originalIndex)}
          afterContent={getAfterContent(config, originalIndex)}
          onRun={config.type === 'freeform' ? async () => onAdvanceToSounds(originalIndex, title) : async () => onRun(originalIndex)}
          onCancel={onStop}
          actionButtonLabel={actionButtonLabel}
          actionButtonDisabled={false}
          color="primary"
          customButtons={customButtons}
          version={getCardVersion(config)}
        />
      );

      return (
        <div key={originalIndex} style={{ position: 'relative' }}>
          {card}
          {showFloatingAction && (
            <CircularFAB
              label={floatingLabel}
              onClick={handleFloatingAction}
              isLoading={floatingIsLoading}
            />
          )}
        </div>
      );
    },
    [
      indexMap,
      hasResult,
      getCollapsedInfo,
      isRunning,
      analyzingConfigIndex,
      analysisStatus,
      analysisResult,
      getBeforeContent,
      getAfterContent,
      getCardVersion,
      onUpdateConfig,
      onRemoveConfig,
      onReset,
      onRun,
      onStop,
      onSendToSoundGeneration,
      onAdvanceToSounds,
      areaDrawing,
    ],
  );

  const header = (
    <div className="text-xs font-medium text-primary">Usage cards</div>
  );

  return (
    <CardSection
      items={usageConfigs}
      availableTypes={availableTypes}
      emptyMessage="No usage cards yet. Add a scenario or typology card, or choose 'Skip usage' to go straight to sounds."
      statusLabel="usage"
      addButtonTitle="Add usage card"
      onAddItem={handleAddConfig}
      renderCard={renderCard}
      header={header}
      getPendingCount={getPendingCount}
      isRunning={isRunning}
      error={error}
      color="primary"
      expandedIndex={filteredExpandedIndex}
      onExpandedIndexChange={handleCardSectionExpandedChange}
      onReorder={(from, to) => {
        const fromOriginal = indexMap[from];
        const toOriginal = indexMap[to];
        if (fromOriginal !== undefined && toOriginal !== undefined) {
          handleReorderConfigs(fromOriginal, toOriginal);
        }
      }}
      onDuplicate={(from, toInsertion) => {
        const fromOriginal = indexMap[from];
        const toOriginal = toInsertion < indexMap.length ? indexMap[toInsertion] : analysisConfigs.length;
        if (fromOriginal !== undefined && toOriginal !== undefined) {
          duplicateConfigAt(fromOriginal, toOriginal);
        }
      }}
    />
  );
}
