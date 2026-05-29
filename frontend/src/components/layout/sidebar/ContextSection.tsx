'use client';

import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import type {
  AnalysisConfig,
  AnalysisResult,
  ModelAnalysisConfig,
  AudioAnalysisConfig,
  AnalyzeModelConfig,
} from '@/types/analysis';
import type { CardTypeOption } from '@/components/ui/CardSection';
import { CARD_TYPE_LABELS } from '@/types/card';
import type { CardType } from '@/types/card';
import { CardSection } from '@/components/ui/CardSection';
import { Card } from '@/components/ui/Card';
import { Model3DContextContent } from '@/components/layout/sidebar/analysis/Model3DContextContent';
import { AudioContextContent } from '@/components/layout/sidebar/analysis/AudioContextContent';
import { AudioAnalysisAfterContent } from '@/components/layout/sidebar/analysis/AudioAnalysisAfterContent';
import { AnalyzeModelContent } from '@/components/layout/sidebar/analysis/AnalyzeModelContent';
import { AnalyzeModelResultContent } from '@/components/layout/sidebar/analysis/AnalyzeModelResultContent';
import { useSpeckleStore, useAnalysisStore, useSoundscapeStore } from '@/store';
import { useServiceVersions } from '@/hooks/useServiceVersions';
import { LLM_MODEL_TO_PROVIDER } from '@/utils/constants';
import { getAnalysisGroupColor } from '@/utils/utils';

// ─── AnalysisGroupColorSync ───────────────────────────────────────────────────
// Applies/clears viewer color groups when a model-analysis card is expanded.

function AnalysisGroupColorSync({
  config,
  isExpanded,
}: {
  config: AnalyzeModelConfig;
  isExpanded: boolean;
}) {
  const objects = config.analysisResult?.architecturalObjects ?? [];
  const prevExpandedRef = useRef(isExpanded);

  useEffect(() => {
    const wasExpanded = prevExpandedRef.current;
    prevExpandedRef.current = isExpanded;

    if (!isExpanded) {
      if (wasExpanded) {
        useSpeckleStore.getState().clearAnalysisObjectGroups();
      }
      return;
    }
    if (objects.length === 0) return;

    const colorGroups = objects
      .map((obj, i) => ({ objectIds: Object.keys(obj.object_ids ?? {}), color: getAnalysisGroupColor(i) }))
      .filter((g) => g.objectIds.length > 0);

    useSpeckleStore.getState().setAnalysisObjectGroups(colorGroups, objects);
    // Clear groups when this component unmounts (i.e., when navigating away from Context section)
    return () => {
      useSpeckleStore.getState().clearAnalysisObjectGroups();
    };
  }, [isExpanded, objects]);

  return null;
}

// ─── CircularFAB ──────────────────────────────────────────────────────────────

interface CircularFABProps {
  label: string;
  onClick: () => void;
  isLoading?: boolean;
}

function CircularFAB({ label, onClick, isLoading }: CircularFABProps) {
  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      title={isLoading ? 'Analyzing\u2026' : label}
      aria-label={isLoading ? 'Analyzing\u2026' : label}
      style={{
        position: 'absolute',
        right: '-14px',
        top: '50%',
        transform: 'translateY(-50%)',
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        backgroundColor: 'var(--color-primary)',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
        cursor: isLoading ? 'not-allowed' : 'pointer',
        border: 'none',
        flexShrink: 0,
        opacity: isLoading ? 0.7 : 1,
        transition: 'transform 150ms ease, box-shadow 150ms ease, opacity 150ms ease',
      }}
      onMouseEnter={(e) => {
        if (!isLoading) (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-50%) scale(1.12)';
      }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-50%)'; }}
    >
      {isLoading ? (
        <span
          className="inline-block w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin"
          aria-hidden="true"
        />
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 7h8M7.5 3.5L11 7l-3.5 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ContextSectionProps {
  /** Full analysisConfigs array — section filters internally to context types */
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
  /** Advance to step 1 (Usage). Receives the original card index and its title. */
  onAdvanceToUsage: (originalIndex: number, title: string) => void;
  /** Extract audio sounds & advance to step 2. Receives original index and title. */
  onAdvanceToSounds: (originalIndex: number, title: string) => void;
  /** Async callback to extract audio SED segments for the FAB (audio cards only). */
  onAudioExtract: (config: AudioAnalysisConfig, originalIndex: number) => Promise<void>;
  /** Controlled expanded index (original index in analysisConfigs) */
  expandedOriginalIndex?: number | null;
  /** Called when the expanded card changes (original index, or null if collapsed) */
  onExpandedOriginalIndexChange?: (originalIndex: number | null) => void;
}

const CONTEXT_CARD_TYPES: CardType[] = ['model-analysis', '3d-model', 'audio'];

// ─── Component ────────────────────────────────────────────────────────────────

export function ContextSection({
  analysisConfigs = [],
  isRunning,
  error,
  analysisResult = [],
  hasGlobalModelLoaded = false,
  onAddConfig,
  onRemoveConfig,
  onUpdateConfig,
  onRun,
  onStop,
  onReset,
  onTogglePromptSelection,
  onSendToSoundGeneration,
  onAdvanceToUsage,
  onAdvanceToSounds,
  onAudioExtract,
  expandedOriginalIndex,
  onExpandedOriginalIndexChange,
}: ContextSectionProps) {
  // Controlled expansion state: filtered index within contextConfigs
  const [filteredExpandedIndex, setFilteredExpandedIndex] = useState<number | null>(null);
  // Tracks which audio card indices are currently extracting (for FAB loading state)
  const [extractingAudioIndices, setExtractingAudioIndices] = useState<Set<number>>(new Set());
  const serviceVersions = useServiceVersions();
  const llmModel = useSoundscapeStore((s) => s.llmModel);
  const { diverseSelectedObjectIds, clearDiverseSelection } = useSpeckleStore();
  const diverseCount = diverseSelectedObjectIds.size;
  const analysisStatus = useAnalysisStore((s) => s.analysisStatus);
  const analyzingConfigIndex = useAnalysisStore((s) => s.analyzingConfigIndex);
  const handleReorderConfigs = useAnalysisStore((s) => s.handleReorderConfigs);

  // Filter to context card types only, maintaining original indices
  const contextConfigs = useMemo(
    () => analysisConfigs.filter((c) => CONTEXT_CARD_TYPES.includes(c.type as CardType)),
    [analysisConfigs],
  );

  // Map from filtered index → original index in analysisConfigs
  const indexMap = useMemo(
    () => contextConfigs.map((cc) => analysisConfigs.indexOf(cc)),
    [contextConfigs, analysisConfigs],
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

  // Auto-expand newly added context cards
  const prevContextLength = useRef(0);
  useEffect(() => {
    if (contextConfigs.length > prevContextLength.current) {
      const lastFi = contextConfigs.length - 1;
      setFilteredExpandedIndex(lastFi);
      const originalIndex = indexMap[lastFi];
      if (originalIndex !== undefined) onExpandedOriginalIndexChange?.(originalIndex);
    }
    prevContextLength.current = contextConfigs.length;
  }, [contextConfigs.length, indexMap, onExpandedOriginalIndexChange]);

  const handleCardSectionExpandedChange = useCallback(
    (fi: number | null) => {
      setFilteredExpandedIndex(fi);
      const originalIndex = fi !== null ? (indexMap[fi] ?? null) : null;
      onExpandedOriginalIndexChange?.(originalIndex);
    },
    [indexMap, onExpandedOriginalIndexChange],
  );

  const hasResult = useCallback(
    (originalIndex: number): boolean => {
      const config = analysisConfigs[originalIndex];
      if (config?.type === 'model-analysis') {
        return (
          ((config as AnalyzeModelConfig).analysisResult?.architecturalObjects?.length ?? 0) > 0
        );
      }
      return analysisResult.some((r) => r.configIndex === originalIndex);
    },
    [analysisResult, analysisConfigs],
  );

  const getResult = useCallback(
    (originalIndex: number) => analysisResult.find((r) => r.configIndex === originalIndex),
    [analysisResult],
  );

  const getCollapsedInfo = useCallback(
    (config: AnalysisConfig, originalIndex: number): string => {
      if (config.type === 'model-analysis') {
        const mc = config as AnalyzeModelConfig;
        const n = mc.analysisResult?.architecturalObjects?.length ?? 0;
        return n > 0 ? `(${n} group${n !== 1 ? 's' : ''} identified)` : '';
      }
      const result = getResult(originalIndex);
      if (result) {
        const selectedCount = result.prompts.filter((p) => p.selected).length;
        return `(${selectedCount} selected prompt${selectedCount !== 1 ? 's' : ''})`;
      }
      if (config.type === '3d-model') {
        const modelConfig = config as ModelAnalysisConfig;
        if (modelConfig.selectedDiverseEntities.length > 0) {
          return `(${modelConfig.selectedDiverseEntities.length} selected entities)`;
        }
      }
      return '';
    },
    [getResult],
  );

  const hasModelLoaded = useMemo(() => {
    if (hasGlobalModelLoaded) return true;
    return analysisConfigs.some(
      (config) =>
        (config.type === '3d-model' &&
          ((config as ModelAnalysisConfig).modelFile !== null ||
            (config as ModelAnalysisConfig).speckleData !== undefined)) ||
        (config.type === 'model-analysis' &&
          (config as AnalyzeModelConfig).speckleData !== undefined),
    );
  }, [analysisConfigs, hasGlobalModelLoaded]);

  const availableTypes: CardTypeOption[] = useMemo(
    () => [
      {
        type: 'model-analysis',
        label: CARD_TYPE_LABELS['model-analysis'],
        enabled: hasModelLoaded,
        disabledTooltip: 'Import a 3D model first (right sidebar)',
      },
      {
        type: '3d-model',
        label: CARD_TYPE_LABELS['3d-model'],
        enabled: hasModelLoaded,
        disabledTooltip: 'Import a 3D model first (right sidebar)',
      },
      {
        type: 'audio',
        label: CARD_TYPE_LABELS['audio'],
        enabled: true,
      },
    ],
    [hasModelLoaded],
  );

  const getBeforeContent = useCallback(
    (config: AnalysisConfig, originalIndex: number) => {
      switch (config.type) {
        case 'model-analysis':
          return (
            <AnalyzeModelContent
              config={config as AnalyzeModelConfig}
              index={originalIndex}
              isAnalyzing={isRunning}
              onUpdateConfig={onUpdateConfig}
            />
          );
        case '3d-model':
          return (
            <Model3DContextContent
              config={config as ModelAnalysisConfig}
              index={originalIndex}
              isAnalyzing={isRunning}
              onUpdateConfig={onUpdateConfig}
            />
          );
        case 'audio':
          return (
            <AudioContextContent
              config={config as AudioAnalysisConfig}
              index={originalIndex}
              isAnalyzing={isRunning}
              onUpdateConfig={onUpdateConfig}
            />
          );
        default:
          return null;
      }
    },
    [isRunning, onUpdateConfig],
  );

  const getAfterContent = useCallback(
    (config: AnalysisConfig, originalIndex: number) => {
      if (config.type === 'model-analysis') {
        const mc = config as AnalyzeModelConfig;
        if ((mc.analysisResult?.architecturalObjects?.length ?? 0) > 0) {
          return <AnalyzeModelResultContent config={mc} />;
        }
        return null;
      }
      const result = getResult(originalIndex);
      if (!result) return null;
      if (config.type === 'audio') {
        const audioConfig = config as AudioAnalysisConfig;
        if (audioConfig.audioFile) {
          return (
            <AudioAnalysisAfterContent
              analysisResult={result}
              audioFile={audioConfig.audioFile}
              audioDuration={audioConfig.audioInfo?.duration ?? 0}
              onTogglePromptSelection={onTogglePromptSelection}
              applyNoiseReduction={audioConfig.applyNoiseReduction ?? false}
              onNoiseReductionChange={(val) => onUpdateConfig(originalIndex, { applyNoiseReduction: val } as Partial<AnalysisConfig>)}
            />
          );
        }
      }
      return null;
    },
    [getResult, onTogglePromptSelection],
  );

  // Build action button state for a context card
  const getActionButton = useCallback(
    (config: AnalysisConfig, originalIndex: number) => {
      switch (config.type) {
        case '3d-model': {
          const modelConfig = config as ModelAnalysisConfig;
          return {
            label:
              modelConfig.selectedDiverseEntities.length === 0
                ? 'Auto-select diverse entities'
                : 'Generate Sound Ideas',
            disabled: modelConfig.modelEntities.length === 0,
            disabledReason:
              modelConfig.modelEntities.length === 0 ? 'Loading objects...' : undefined,
            color:
              modelConfig.selectedDiverseEntities.length === 0 ? 'success' : 'success-hover',
          };
        }
        case 'audio': {
          const audioConfig = config as AudioAnalysisConfig;
          return {
            label: 'Analyze Sound Events',
            disabled: audioConfig.audioFile === null,
            disabledReason: audioConfig.audioFile === null ? 'No audio file loaded' : undefined,
            color: 'success',
          };
        }
        case 'model-analysis': {
          const analyzeConfig = config as AnalyzeModelConfig;
          return {
            label: 'Analyze 3D Model',
            disabled: analyzeConfig.modelEntities.length === 0,
            disabledReason:
              analyzeConfig.modelEntities.length === 0 ? 'Loading model objects…' : undefined,
            color: 'success',
          };
        }
        default:
          return { label: 'Run', disabled: false, disabledReason: undefined, color: 'success' };
      }
    },
    [],
  );

  // Get card version string
  const getCardVersion = useCallback(
    (config: AnalysisConfig): string | undefined => {
      if (!serviceVersions) return undefined;
      if (config.type === 'audio') {
        const v = serviceVersions.yamnet;
        return `${v.name} ${v.version}`;
      }
      if (
        config.type === '3d-model' ||
        config.type === 'model-analysis'
      ) {
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

  // Render card — wraps Card with optional circular FAB
  const renderCard = useCallback(
    (
      config: AnalysisConfig,
      filteredIndex: number,
      isExpanded: boolean,
      onToggleExpand: (index: number) => void,
    ) => {
      const originalIndex = indexMap[filteredIndex] ?? filteredIndex;
      const configHasResult = hasResult(originalIndex);
      const showFloatingAction = configHasResult && isExpanded;
      const actionBtn = getActionButton(config, originalIndex);
      const title = config.displayName || CARD_TYPE_LABELS[config.type as CardType] || 'Card';

      // Floating action: audio extracts & sends to Sounds; others advance to Usage
      const floatingLabel =
        config.type === 'audio'
          ? (extractingAudioIndices.has(originalIndex) ? 'Extracting…' : 'Extract & go to Sounds')
          : 'Next: Usage';
      const handleFloatingAction =
        config.type === 'audio'
          ? async () => {
              if (extractingAudioIndices.has(originalIndex)) return;
              const audioConfig = config as AudioAnalysisConfig;
              setExtractingAudioIndices((prev) => new Set([...prev, originalIndex]));
              try {
                await onAudioExtract(audioConfig, originalIndex);
              } catch (err: any) {
                console.error('[ContextSection] Audio extraction failed:', err);
              } finally {
                setExtractingAudioIndices((prev) => {
                  const next = new Set(prev);
                  next.delete(originalIndex);
                  return next;
                });
              }
              onAdvanceToSounds(originalIndex, title);
            }
          : () => onAdvanceToUsage(originalIndex, title);

      const card = (
        <Card
          config={config}
          index={filteredIndex}
          isExpanded={isExpanded}
          hasResult={configHasResult}
          result={getResult(originalIndex)}
          isRunning={isRunning && analyzingConfigIndex === originalIndex}
          status={
            analyzingConfigIndex === originalIndex ? analysisStatus : undefined
          }
          collapsedInfo={getCollapsedInfo(config, originalIndex)}
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
          onRun={async () => onRun(originalIndex)}
          onCancel={onStop}
          actionButtonLabel={actionBtn.label}
          actionButtonDisabled={actionBtn.disabled}
          actionButtonDisabledReason={actionBtn.disabledReason}
          actionButtonColor={actionBtn.color}
          color="primary"
          version={getCardVersion(config)}
        />
      );

      const wrapped = (
        <div key={originalIndex} style={{ position: 'relative' }}>
          {card}
          {showFloatingAction && (
            <CircularFAB
              label={floatingLabel}
              onClick={handleFloatingAction as () => void}
              isLoading={(isRunning && analyzingConfigIndex === originalIndex) || extractingAudioIndices.has(originalIndex)}
            />
          )}
        </div>
      );

      if (config.type === 'model-analysis') {
        return (
          <>
            <AnalysisGroupColorSync
              config={config as AnalyzeModelConfig}
              isExpanded={isExpanded}
            />
            {wrapped}
          </>
        );
      }
      return wrapped;
    },
    [
      indexMap,
      hasResult,
      getResult,
      isRunning,
      analyzingConfigIndex,
      analysisStatus,
      getCollapsedInfo,
      getActionButton,
      getBeforeContent,
      getAfterContent,
      getCardVersion,
      onUpdateConfig,
      onRemoveConfig,
      onReset,
      onRun,
      onStop,
      onSendToSoundGeneration,
      onAdvanceToUsage,
      onAdvanceToSounds,
      onAudioExtract,
      extractingAudioIndices,
    ],
  );

  const header = (
    <div className="text-xs font-medium text-primary">Context cards</div>
  );

  return (
    <div className="flex flex-col min-h-0">
      <CardSection
        items={contextConfigs}
        availableTypes={availableTypes}
        emptyMessage="No context cards yet. Import a 3D model from the right sidebar to get started."
        statusLabel="context"
        addButtonTitle="Add context card"
        onAddItem={onAddConfig}
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
      />

      {/* Diverse selection indicator */}
      {diverseCount > 0 && (
        <div className="flex items-center justify-between py-2">
          <span className="text-xs text-primary">
            {diverseCount} object{diverseCount !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={clearDiverseSelection}
            className="w-5 h-5 flex items-center justify-center rounded-full text-secondary-hover hover:bg-secondary-light hover:text-foreground transition-all cursor-pointer"
            title="Clear diverse selection"
          >
            <span className="text-lg leading-none">×</span>
          </button>
        </div>
      )}
    </div>
  );
}
