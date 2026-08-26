'use client';

import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import type {
  AnalysisConfig,
  AnalysisResult,
  ModelAnalysisConfig,
  AudioAnalysisConfig,
  AnalyzeModelConfig,
  AnalysisBaseConfig,
} from '@/types/analysis';
import type { CardTypeOption } from '@/components/ui/CardSection';
import { CARD_TYPE_LABELS } from '@/types/card';
import type { CardType } from '@/types/card';
import type { CustomMenuItem } from '@/types/card';
import { CardSection } from '@/components/ui/CardSection';
import { Card } from '@/components/ui/Card';
import { Model3DContextContent } from '@/components/layout/sidebar/analysis/Model3DContextContent';
import { AudioContextContent } from '@/components/layout/sidebar/analysis/AudioContextContent';
import { AudioAnalysisAfterContent } from '@/components/layout/sidebar/analysis/AudioAnalysisAfterContent';
import { AnalyzeModelContent } from '@/components/layout/sidebar/analysis/AnalyzeModelContent';
import { AnalyzeModelResultContent } from '@/components/layout/sidebar/analysis/AnalyzeModelResultContent';
import { useSpeckleStore, useAnalysisStore, useSoundscapeStore } from '@/store';
import { useUIStore } from '@/store/uiStore';
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

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ContextSectionProps {
  /** Full analysisConfigs array — section filters internally to context types */
  analysisConfigs: AnalysisConfig[];
  isRunning: boolean;
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

const CONTEXT_CARD_TYPES: CardType[] = ['model-analysis', '3d-model', 'audio', 'freeform'];

// ─── Component ────────────────────────────────────────────────────────────────

export function ContextSection({
  analysisConfigs = [],
  isRunning,
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
  const duplicateConfigAt = useAnalysisStore((s) => s.duplicateConfigAt);

  const showSpectrograms    = useUIStore((s) => s.showSpectrograms);
  const setShowSpectrograms = useUIStore((s) => s.setShowSpectrograms);

  // Filter to context card types only, maintaining original indices
  // Freeform cards with parentContextOriginalIndex belong to Usage, exclude them here.
  const contextConfigs = useMemo(
    () => analysisConfigs.filter((c) => {
      if (!CONTEXT_CARD_TYPES.includes(c.type as CardType)) return false;
      if (c.type === 'freeform' && (c as AnalysisBaseConfig).parentContextOriginalIndex !== undefined) return false;
      return true;
    }),
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

  // Auto-expand newly added context cards; auto-advance for freeform cards
  // Initialize to current length so existing cards don't re-trigger auto-advance on remount
  const prevContextLength = useRef(contextConfigs.length);
  useEffect(() => {
    if (contextConfigs.length > prevContextLength.current) {
      const lastFi = contextConfigs.length - 1;
      const originalIndex = indexMap[lastFi];
      const newConfig = contextConfigs[lastFi];

      if (newConfig?.type === 'freeform') {
        // Skip expansion — jump straight to Usage step
        const name = newConfig.display_name || 'Untitled context';
        if (originalIndex !== undefined) onAdvanceToUsage(originalIndex, name);
      } else {
        setFilteredExpandedIndex(lastFi);
        if (originalIndex !== undefined) onExpandedOriginalIndexChange?.(originalIndex);
      }
    }
    prevContextLength.current = contextConfigs.length;
  }, [contextConfigs.length, indexMap, onExpandedOriginalIndexChange, onAdvanceToUsage]);

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
      // Freeform cards need no analysis — FAB shows immediately.
      if (config?.type === 'freeform') return true;
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

  // Wrap onAddConfig: freeform cards get named and the effect handles auto-advance
  const handleAddContextConfig = useCallback((type: CardType) => {
    if (type === 'freeform') {
      const nextIndex = analysisConfigs.length;
      onAddConfig('freeform');
      onUpdateConfig(nextIndex, { display_name: 'Untitled context' } as Partial<AnalysisConfig>);
    } else {
      onAddConfig(type);
    }
  }, [analysisConfigs.length, onAddConfig, onUpdateConfig]);

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
        disabledTooltip: 'Import a 3D model first',
      },
      {
        type: 'audio',
        label: CARD_TYPE_LABELS['audio'],
        enabled: true,
      },
      {
        type: 'freeform',
        label: 'Placeholder context',
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
        case 'freeform': {
          const USAGE_TYPES_CHECK = ['scenario', 'text', 'freeform'];
          const childUsage = analysisConfigs.filter(
            (c) =>
              USAGE_TYPES_CHECK.includes(c.type as CardType) &&
              (c as AnalysisBaseConfig).parentContextOriginalIndex === originalIndex,
          );
          return (
            <div className="px-1 py-2 text-xs space-y-1" style={{ color: 'var(--color-on-blue-muted)' }}>
              {childUsage.length === 0 ? (
                <p>No usage cards linked. Click &quot;Next: Usage&quot; to add usage scenarios.</p>
              ) : (
                <>
                  <p className="font-medium mb-1" style={{ color: 'var(--color-on-blue)' }}>Linked usage cards:</p>
                  <ul className="space-y-0.5">
                    {childUsage.map((c, i) => (
                      <li key={i} className="flex items-center gap-1">
                        <span>•</span>
                        <span>{(c as AnalysisBaseConfig).display_name || CARD_TYPE_LABELS[c.type as CardType] || 'Card'}</span>
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
    [isRunning, onUpdateConfig, analysisConfigs],
  );

  const getAfterContent = useCallback(
    (config: AnalysisConfig, originalIndex: number) => {
      if (config.type === 'model-analysis') {
        const mc = config as AnalyzeModelConfig;
        if ((mc.analysisResult?.architecturalObjects?.length ?? 0) > 0) {
          return <AnalyzeModelResultContent config={mc} configIndex={originalIndex} />;
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
              modelConfig.modelEntities.length === 0 ? 'No 3D model loaded' : undefined,
            color:
              modelConfig.selectedDiverseEntities.length === 0 ? 'success' : 'success-hover',
          };
        }
        case 'audio': {
          const audioConfig = config as AudioAnalysisConfig;
          return {
            label: 'Analyze Sound Events',
            disabled: audioConfig.audioFile === null,
            disabledReason: audioConfig.audioFile === null ? 'No audio file uploaded' : undefined,
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
          return { label: 'Run', disabled: true, disabledReason: 'No analysis for this card type', color: 'success' };
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

  // Render card — the unified bottom bar (idle → run, generating → progress+stop,
  // done → continue action) replaces the old circular FAB.
  const renderCard = useCallback(
    (
      config: AnalysisConfig,
      filteredIndex: number,
      isExpanded: boolean,
      onToggleExpand: (index: number) => void,
    ) => {
      const originalIndex = indexMap[filteredIndex] ?? filteredIndex;
      const configHasResult = config.type === 'freeform' ? true : hasResult(originalIndex);
      const actionBtn = getActionButton(config, originalIndex);
      const title = config.display_name || CARD_TYPE_LABELS[config.type as CardType] || 'Card';

      const isAudio = config.type === 'audio';
      const isExtracting = extractingAudioIndices.has(originalIndex);

      // Spectrogram toggle — only when the audio card shows a WaveSurfer preview
      // (an audio file is loaded). Reuses the global showSpectrograms setting from
      // AdvancedSettings → Sound Rendering.
      const hasWavesurferViewer = isAudio && !!(config as AudioAnalysisConfig).audioFile;
      const customButtons: CustomMenuItem[] = [];
      if (hasWavesurferViewer) {
        customButtons.push({
          key: 'spectrogram',
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 18V6m4 12V10m4 8V4m4 14v-6m4 6V8" />
            </svg>
          ),
          label: showSpectrograms ? 'Hide spectrogram' : 'Show spectrogram',
          isActive: showSpectrograms,
          onClick: (e) => { e.stopPropagation(); setShowSpectrograms(!showSpectrograms); },
        });
      }


      // Done-state continue action: audio extracts & sends to Sounds; others advance to Usage
      const doneActionLabel = isAudio ? 'Extract & go to Sounds' : 'Next: Usage';
      const handleDoneAction =
        isAudio
          ? async () => {
              if (isExtracting) return;
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
          isRunning={(isRunning && analyzingConfigIndex === originalIndex) || isExtracting}
          status={
            isExtracting
              ? 'Extracting…'
              : analyzingConfigIndex === originalIndex
                ? analysisStatus
                : undefined
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
          error={config.error || null}
          onDismissError={() => onUpdateConfig(originalIndex, { error: null })}
          beforeContent={getBeforeContent(config, originalIndex)}
          afterContent={getAfterContent(config, originalIndex)}
          onRun={async () => onRun(originalIndex)}
          onCancel={isExtracting ? undefined : onStop}
          actionButtonLabel={actionBtn.label}
          actionButtonDisabled={actionBtn.disabled}
          actionButtonDisabledReason={actionBtn.disabledReason}
          actionButtonColor={actionBtn.color}
          doneActionLabel={configHasResult ? doneActionLabel : undefined}
          onDoneAction={configHasResult ? handleDoneAction : undefined}
          color="primary"
          version={getCardVersion(config)}
          customButtons={customButtons.length > 0 ? customButtons : undefined}
        />
      );

      if (config.type === 'model-analysis') {
        return (
          <>
            <AnalysisGroupColorSync
              config={config as AnalyzeModelConfig}
              isExpanded={isExpanded}
            />
            {card}
          </>
        );
      }
      return card;
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
      showSpectrograms,
      setShowSpectrograms,
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
        emptyMessage="No context cards yet. Add a context card to analyse your scene, or choose 'Skip context' to create sounds directly."
        statusLabel="context"
        addButtonTitle="Add context card"
        onAddItem={handleAddContextConfig}
        renderCard={renderCard}
        header={header}
        getPendingCount={getPendingCount}
        isRunning={isRunning}
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
