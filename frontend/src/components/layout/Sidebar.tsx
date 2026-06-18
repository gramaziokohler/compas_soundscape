"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ContextSection } from "./sidebar/ContextSection";
import { UsageSection } from "./sidebar/UsageSection";
import { SoundGenerationSection } from "./sidebar/SoundGenerationSection";
import { UI_SIDEBAR_RESIZE } from "@/utils/constants";
import { useSidebarResize } from "@/hooks/useSidebarResize";
import { useTextGenerationStore } from "@/store/textGenerationStore";
import { useCardFlowStore } from "@/store/cardFlowStore";
import { useUIStore } from "@/store/uiStore";
import type { SidebarProps } from "@/types/components";
import { CARD_TYPE_LABELS } from "@/types/card";
import type { CardType } from "@/types/card";

type Step = 0 | 1 | 2;

// ─── Module-level tooltip helpers ────────────────────────────────────────────

const SIDEBAR_CONTEXT_TYPES: CardType[] = ['model-analysis', '3d-model', 'audio', 'freeform'];
const SIDEBAR_USAGE_TYPES: CardType[] = ['scenario', 'text', 'freeform'];

function cardLabelHelper(config: any, fallback: string): string {
  if (!config) return fallback;
  if (config.display_name) return config.display_name;
  if (config.audioFile?.name) return config.audioFile.name;
  if (config.modelFile?.name) return config.modelFile.name;
  return CARD_TYPE_LABELS[config.type as CardType] || fallback;
}

export function Sidebar(props: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentStep, setCurrentStep] = useState<Step>(0);
  const [isHandleHovered, setIsHandleHovered] = useState(false);
  const [contextExpandedOriginalIndex, setContextExpandedOriginalIndex] = useState<number | null>(null);
  const [usageExpandedOriginalIndex, setUsageExpandedOriginalIndex] = useState<number | null>(null);
  // Whether we navigated Context→Sounds directly (audio), bypassing the Usage step
  const [bypassedUsage, setBypassedUsage] = useState(false);
  // Active parent indices — used to filter child cards in each section
  const [activeContextOriginalIndex, setActiveContextOriginalIndex] = useState<number | null>(null);
  const [activeUsageOriginalIndex, setActiveUsageOriginalIndex] = useState<number | null>(null);
  // Refs that remember which card was open before leaving each section
  const savedContextExpandedRef = useRef<number | null>(null);
  const savedUsageExpandedRef = useRef<number | null>(null);

  const cardFlowStore = useCardFlowStore();

  // Breadcrumb labels derived reactively — ALL navigation paths update the same index
  // state, so labels are always consistent (FAB, breadcrumb click, or skip).
  // We replicate getCardDefaultName logic: display_name > file name > type label.
  function getConfigLabel(config: import('@/types/analysis').AnalysisConfig | undefined, fallback: string): string {
    if (!config) return fallback;
    if (config.display_name) return config.display_name;
    if ('audioFile' in config && (config as any).audioFile?.name) return (config as any).audioFile.name;
    if ('modelFile' in config && (config as any).modelFile?.name) return (config as any).modelFile.name;
    return fallback;
  }

  const contextBreadcrumbLabel =
    currentStep > 0 && activeContextOriginalIndex !== null
      ? getConfigLabel(props.analysisConfigs[activeContextOriginalIndex], 'Context')
      : currentStep === 0 && contextExpandedOriginalIndex !== null
      ? getConfigLabel(props.analysisConfigs[contextExpandedOriginalIndex], 'Context')
      : 'Context';

  const usageBreadcrumbLabel =
    !bypassedUsage && currentStep > 1 && activeUsageOriginalIndex !== null
      ? getConfigLabel(props.analysisConfigs[activeUsageOriginalIndex], 'Usage')
      : currentStep === 1 && usageExpandedOriginalIndex !== null
      ? getConfigLabel(props.analysisConfigs[usageExpandedOriginalIndex], 'Usage')
      : 'Usage';

  // ─── Breadcrumb tooltips ─────────────────────────────────────────────────
  const contextTooltip = useMemo(() => {
    const cards = props.analysisConfigs
      .map((c, idx) => ({ c, idx }))
      .filter(({ c }) =>
        SIDEBAR_CONTEXT_TYPES.includes(c.type as CardType) &&
        !(c.type === 'freeform' && (c as any).parentContextOriginalIndex !== undefined)
      );
    if (cards.length === 0) return undefined;
    return cards
      .map(({ c, idx }) => {
        const label = cardLabelHelper(c, `Context ${idx + 1}`);
        const pending =
          c.type === 'freeform'
            ? false
            : c.type === 'model-analysis'
            ? ((c as any).analysisResult?.architecturalObjects?.length ?? 0) === 0
            : !props.analysisResult.some((r: any) => r.configIndex === idx);
        return `• ${label}${pending ? ' (pending)' : ''}`;
      })
      .join('\n');
  }, [props.analysisConfigs, props.analysisResult]);

  const usageTooltip = useMemo(() => {
    const cards = props.analysisConfigs
      .map((c, idx) => ({ c, idx }))
      .filter(({ c }) =>
        SIDEBAR_USAGE_TYPES.includes(c.type as CardType) &&
        !(c.type === 'freeform' && (c as any).parentContextOriginalIndex === undefined)
      );
    if (cards.length === 0) return undefined;
    return cards
      .map(({ c, idx }) => {
        const label = cardLabelHelper(c, `Usage ${idx + 1}`);
        const pending =
          c.type === 'freeform'
            ? false
            : c.type === 'scenario'
            ? !(c as any).foleyResult
            : !props.analysisResult.some((r: any) => r.configIndex === idx);
        return `• ${label}${pending ? ' (pending)' : ''}`;
      })
      .join('\n');
  }, [props.analysisConfigs, props.analysisResult]);

  const soundsTooltip = useMemo(() => {
    if (props.soundConfigs.length === 0) return undefined;
    // Group sound configs by their parent usage index
    const groups = new Map<number | null, typeof props.soundConfigs>();
    props.soundConfigs.forEach((s) => {
      const key = s.parentUsageOriginalIndex ?? null;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    });
    const lines: string[] = [];
    groups.forEach((sounds, usageIdx) => {
      let groupLabel: string;
      if (usageIdx === null) {
        groupLabel = 'Unlinked';
      } else if (usageIdx < 0) {
        // Negative index: audio context bypassed usage
        const ctxIdx = -(usageIdx + 1);
        groupLabel = cardLabelHelper(props.analysisConfigs[ctxIdx], 'Audio context');
      } else {
        groupLabel = cardLabelHelper(props.analysisConfigs[usageIdx], `Usage ${usageIdx + 1}`);
      }
      lines.push(`${groupLabel}:`);
      sounds.forEach((s, si) => {
        const soundLabel = s.display_name || s.prompt || `Sound ${si + 1}`;
        const soundOrigIdx = props.soundConfigs.indexOf(s);
        const pending = !props.generatedSounds.some((g: any) => g.prompt_index === soundOrigIdx);
        lines.push(`  • ${soundLabel}${pending ? ' (pending)' : ''}`);
      });
    });
    return lines.length > 0 ? lines.join('\n') : undefined;
  }, [props.analysisConfigs, props.soundConfigs, props.generatedSounds]);

  // Expand sidebar when "Configure API tokens" is triggered from anywhere
  const tokenSettingsTrigger = useTextGenerationStore(s => s.tokenSettingsTrigger);
  useEffect(() => {
    if (tokenSettingsTrigger > 0) setIsExpanded(true);
  }, [tokenSettingsTrigger]);

  // Advance to step 2 (Sounds) when stepAdvanceTrigger increments
  const prevTriggerRef = useRef(props.stepAdvanceTrigger ?? 0);
  useEffect(() => {
    const trigger = props.stepAdvanceTrigger ?? 0;
    if (trigger > prevTriggerRef.current) {
      prevTriggerRef.current = trigger;
      const parentIndex = useUIStore.getState().activeSoundParentIndex;
      if (parentIndex !== null) {
        // A specific parent was pre-set (e.g. during soundscape restore) —
        // sync the sidebar filter so only that parent's children are shown.
        setActiveUsageOriginalIndex(parentIndex);
      }
      useUIStore.getState().setIsInSoundsStep(true);
      setCurrentStep(2);
      setIsExpanded(true);
    }
  }, [props.stepAdvanceTrigger]);

  const { width: contentWidth, isResizing, handleMouseDown: handleResizeMouseDown } = useSidebarResize({
    initialWidth: UI_SIDEBAR_RESIZE.LEFT_DEFAULT_WIDTH,
    minWidth: UI_SIDEBAR_RESIZE.LEFT_MIN_WIDTH,
    maxWidth: UI_SIDEBAR_RESIZE.LEFT_MAX_WIDTH,
    direction: 'right',
    onWidthChange: props.onWidthChange,
  });

  // Notify parent when expanded state changes
  useEffect(() => {
    props.onExpandedChange?.(isExpanded);
  }, [isExpanded, props.onExpandedChange]);

  // Step navigation helpers
  const advanceToUsage = useCallback((originalIndex: number, _title: string) => {
    useCardFlowStore.getState().recordContextAdvance(originalIndex);
    savedContextExpandedRef.current = null;
    setContextExpandedOriginalIndex(null);
    setActiveContextOriginalIndex(originalIndex);
    setBypassedUsage(false);
    useUIStore.getState().setActiveSoundParentIndex(null);
    setCurrentStep(1);
    setIsExpanded(true);
  }, []);

  const handleContextSendToSounds = useCallback((originalIndex: number, _title: string) => {
    useCardFlowStore.getState().recordContextAdvance(originalIndex);
    savedContextExpandedRef.current = null;
    setContextExpandedOriginalIndex(null);
    setActiveContextOriginalIndex(originalIndex);
    // Audio context bypasses Usage — use negative namespace key so sounds filter correctly.
    const audioParentKey = -(originalIndex + 1);
    setBypassedUsage(true);
    setActiveUsageOriginalIndex(audioParentKey); // needed so SoundGenerationSection shows the right cards
    useUIStore.getState().setActiveSoundParentIndex(audioParentKey);
    setCurrentStep(2);
    setIsExpanded(true);
  }, []);

  const handleUsageSendToSounds = useCallback((originalIndex: number, _title: string) => {
    useCardFlowStore.getState().recordUsageAdvance(originalIndex);
    savedUsageExpandedRef.current = null;
    setUsageExpandedOriginalIndex(null);
    setActiveUsageOriginalIndex(originalIndex);
    setBypassedUsage(false);
    props.onSendToSoundGeneration(originalIndex);
    useUIStore.getState().setActiveSoundParentIndex(originalIndex);
    setCurrentStep(2);
    setIsExpanded(true);
  }, [props.onSendToSoundGeneration]);

  const skipStep = useCallback(() => {
    if (currentStep === 0) {
      savedContextExpandedRef.current = contextExpandedOriginalIndex;
      setContextExpandedOriginalIndex(null);
    } else if (currentStep === 1) {
      savedUsageExpandedRef.current = usageExpandedOriginalIndex;
      setUsageExpandedOriginalIndex(null);
      // Skipping from Usage to Sounds with no parent — keep activeSoundParentIndex null
      // but flag that we ARE in the Sounds step so unparented sounds are shown.
      useUIStore.getState().setActiveSoundParentIndex(null);
      useUIStore.getState().setIsInSoundsStep(true);
    }
    setCurrentStep(s => (Math.min(s + 1, 2) as Step));
    setIsExpanded(true);
  }, [currentStep, contextExpandedOriginalIndex, usageExpandedOriginalIndex]);

  return (
    <>
      {/* Toggle button — floats at the right edge of the sidebar content */}
      <button
        onClick={() => setIsExpanded(prev => !prev)}
        title={isExpanded ? 'Collapse panel' : 'Open panel'}
        style={{
          position: 'fixed',
          left: isExpanded ? `${contentWidth}px` : '0px',
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 15,
          transition: 'left 300ms ease-in-out',
        }}
        className="flex flex-col items-center justify-center w-5 py-3 gap-1.5 bg-primary border border-secondary-light rounded-r-md shadow-md hover:bg-primary-hover"
      >
        <svg width="10" height="16" viewBox="0 0 10 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          {isExpanded ? (
            <path d="M7 3L2 8L7 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M3 3L8 8L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
        {!isExpanded && (
          <span
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: '12px', letterSpacing: '0.05em' }}
            className="text-secondary-light-static select-none"
          >
            Soundscape
          </span>
        )}
      </button>

      {/* Sidebar content panel */}
      <aside
        className="fixed top-0 left-0 h-screen flex flex-col transition-all duration-300 ease-in-out bg-background border-r border-secondary-light shadow-lg"
        style={{
          width: isExpanded ? `${contentWidth}px` : '0px',
          overflow: 'hidden',
          opacity: isExpanded ? 0.95 : 0,
          zIndex: 10,
          userSelect: isResizing ? 'none' : undefined,
        }}
      >
        {/* Resize handle — right edge */}
        {isExpanded && (
          <div
            onMouseDown={handleResizeMouseDown}
            onMouseEnter={() => setIsHandleHovered(true)}
            onMouseLeave={() => setIsHandleHovered(false)}
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: `${UI_SIDEBAR_RESIZE.HANDLE_HIT_AREA}px`,
              height: '100%',
              cursor: 'col-resize',
              zIndex: 20,
              display: 'flex',
              alignItems: 'stretch',
              justifyContent: 'flex-end',
            }}
          >
            <div
              style={{
                width: `${UI_SIDEBAR_RESIZE.HANDLE_WIDTH}px`,
                height: '100%',
                backgroundColor: (isHandleHovered || isResizing) ? 'var(--color-primary)' : 'transparent',
                transition: 'background-color 150ms ease',
                borderRadius: '2px',
              }}
            />
          </div>
        )}

        <div className="flex-shrink-0 px-4 pt-4 pb-2">
          <nav className="flex font-semibold items-center gap-1 text-xs select-none" aria-label="Steps">
            {/* Context step */}
            <button
              className={`transition-colors flex-1 min-w-0 truncate ${
                currentStep === 0
                  ? 'bg-primary text-secondary px-0.5 py-0.5'
                  : 'text-primary hover:bg-secondary-light cursor-pointer'
              }`}
              onClick={() => {
                setUsageExpandedOriginalIndex(null);
                setContextExpandedOriginalIndex(savedContextExpandedRef.current);
                setBypassedUsage(false);
                useUIStore.getState().setActiveSoundParentIndex(null);
                setCurrentStep(0);
              }}
              aria-current={currentStep === 0 ? 'step' : undefined}
              title={contextTooltip}
            >
              {contextBreadcrumbLabel}
            </button>
            <span className="text-secondary-hover shrink-0" aria-hidden="true">›</span>
            {/* Usage step — greyed out when audio context bypassed it, or no advancement yet */}
            {(() => {
              // Audio context cards bypass Usage — grey it out whenever one is active/expanded.
              const expandedIsAudio =
                contextExpandedOriginalIndex !== null &&
                props.analysisConfigs[contextExpandedOriginalIndex]?.type === 'audio';
              const activeIsAudio =
                currentStep > 0 &&
                activeContextOriginalIndex !== null &&
                props.analysisConfigs[activeContextOriginalIndex]?.type === 'audio';
              const usageClickable =
                !bypassedUsage &&
                !expandedIsAudio &&
                !activeIsAudio &&
                (currentStep > 0 ||
                  (contextExpandedOriginalIndex !== null &&
                    cardFlowStore.hasContextAdvanced(contextExpandedOriginalIndex)));
              const usageActive = currentStep === 1;
              return (
                <button
                  className={`transition-colors flex-1 min-w-0 truncate ${
                    usageActive
                      ? 'bg-primary text-secondary px-0.5 py-0.5'
                      : usageClickable
                      ? 'text-primary hover:bg-secondary-light cursor-pointer'
                      : 'text-secondary-hover opacity-70 cursor-default'
                  }`}
                  onClick={() => {
                    if (!usageClickable) return;
                    if (currentStep === 0 && contextExpandedOriginalIndex !== null) {
                      setActiveContextOriginalIndex(contextExpandedOriginalIndex);
                      savedContextExpandedRef.current = contextExpandedOriginalIndex;
                      setContextExpandedOriginalIndex(null);
                    }
                    useUIStore.getState().setActiveSoundParentIndex(null);
                    setBypassedUsage(false);
                    setUsageExpandedOriginalIndex(savedUsageExpandedRef.current);
                    setCurrentStep(1);
                  }}
                  aria-current={usageActive ? 'step' : undefined}
                  title={usageTooltip}
                >
                  {usageBreadcrumbLabel}
                </button>
              );
            })()}
            <span className="text-secondary-hover shrink-0" aria-hidden="true">›</span>
            {/* Sounds step — clickable when at step 2, when a usage card has sounds, or when an audio/non-audio context has sent sounds */}
            {(() => {
              // Non-audio context with usage children that advanced to Sounds
              const soundsClickableFromUsageChildren =
                currentStep === 0 &&
                contextExpandedOriginalIndex !== null &&
                props.analysisConfigs.some(
                  (cfg, idx) =>
                    cfg.parentContextOriginalIndex === contextExpandedOriginalIndex &&
                    cardFlowStore.hasUsageAdvanced(idx),
                );
              // Audio context that already sent sounds (bypassed Usage)
              const soundsClickableFromAudioContext =
                currentStep === 0 &&
                contextExpandedOriginalIndex !== null &&
                props.analysisConfigs[contextExpandedOriginalIndex]?.type === 'audio' &&
                cardFlowStore.hasContextAdvanced(contextExpandedOriginalIndex);
              const soundsClickableFromContext = soundsClickableFromUsageChildren || soundsClickableFromAudioContext;
              const soundsClickable =
                currentStep === 2 ||
                soundsClickableFromContext ||
                (currentStep === 1 &&
                  usageExpandedOriginalIndex !== null &&
                  cardFlowStore.hasUsageAdvanced(usageExpandedOriginalIndex));
              const soundsActive = currentStep === 2;
              return (
                <button
                  className={`transition-colors flex-1 min-w-0 truncate ${
                    soundsActive
                      ? 'bg-primary text-secondary px-0.5 py-0.5'
                      : soundsClickable
                      ? 'text-primary hover:bg-secondary-light cursor-pointer'
                      : 'text-secondary-hover opacity-70 cursor-default'
                  }`}
                  onClick={() => {
                    if (!soundsClickable) return;
                    if (currentStep === 1) {
                      // Update active parent to whichever usage card is expanded NOW
                      if (usageExpandedOriginalIndex !== null) {
                        setActiveUsageOriginalIndex(usageExpandedOriginalIndex);
                        useUIStore.getState().setActiveSoundParentIndex(usageExpandedOriginalIndex);
                      } else if (activeUsageOriginalIndex !== null) {
                        // No card expanded — restore the previously active parent
                        useUIStore.getState().setActiveSoundParentIndex(activeUsageOriginalIndex);
                      } else {
                        // Fully unparented (skip flow)
                        useUIStore.getState().setIsInSoundsStep(true);
                      }
                      savedUsageExpandedRef.current = usageExpandedOriginalIndex;
                      setUsageExpandedOriginalIndex(null);
                    }
                    if (soundsClickableFromContext && contextExpandedOriginalIndex !== null) {
                      const ctxCfg = props.analysisConfigs[contextExpandedOriginalIndex];
                      setActiveContextOriginalIndex(contextExpandedOriginalIndex);
                      savedContextExpandedRef.current = contextExpandedOriginalIndex;
                      setContextExpandedOriginalIndex(null);
                      if (ctxCfg?.type === 'audio') {
                        const audioParentKey = -(contextExpandedOriginalIndex + 1);
                        setBypassedUsage(true);
                        setActiveUsageOriginalIndex(audioParentKey);
                        useUIStore.getState().setActiveSoundParentIndex(audioParentKey);
                      } else {
                        const lastUsageIdx = props.analysisConfigs.reduce<number | null>((found, cfg, idx) => {
                          if (cfg.parentContextOriginalIndex === contextExpandedOriginalIndex &&
                              cardFlowStore.hasUsageAdvanced(idx)) return idx;
                          return found;
                        }, null);
                        setActiveUsageOriginalIndex(lastUsageIdx);
                        setBypassedUsage(false);
                        if (lastUsageIdx !== null) {
                          useUIStore.getState().setActiveSoundParentIndex(lastUsageIdx);
                        } else {
                          useUIStore.getState().setIsInSoundsStep(true);
                        }
                      }
                    }
                    setCurrentStep(2);
                  }}
                  aria-current={soundsActive ? 'step' : undefined}
                  title={soundsTooltip}
                >
                  Sounds
                </button>
              );
            })()}
          </nav>
        </div>

        {/* Scrollable step content */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {currentStep === 0 && (
            <ContextSection
              analysisConfigs={props.analysisConfigs}
              isRunning={props.isAnalyzing}
              error={props.analysisError}
              analysisResult={props.analysisResult}
              hasGlobalModelLoaded={props.hasGlobalModelLoaded}
              onAddConfig={props.onAddAnalysisConfig}
              onRemoveConfig={props.onRemoveAnalysisConfig}
              onUpdateConfig={props.onUpdateAnalysisConfig}
              onRun={props.onAnalyze}
              onStop={props.onStop}
              onReset={props.onResetAnalysis}
              onTogglePromptSelection={props.onTogglePromptSelection}
              onSendToSoundGeneration={props.onSendToSoundGeneration}
              onAdvanceToUsage={advanceToUsage}
              onAdvanceToSounds={handleContextSendToSounds}
              onAudioExtract={props.onAudioExtract}
              expandedOriginalIndex={contextExpandedOriginalIndex}
              onExpandedOriginalIndexChange={setContextExpandedOriginalIndex}
            />
          )}

          {currentStep === 1 && (
            <UsageSection
              analysisConfigs={props.analysisConfigs}
              isRunning={props.isAnalyzing}
              error={props.analysisError}
              analysisResult={props.analysisResult}
              hasGlobalModelLoaded={props.hasGlobalModelLoaded}
              onAddConfig={props.onAddAnalysisConfig}
              onRemoveConfig={props.onRemoveAnalysisConfig}
              onUpdateConfig={props.onUpdateAnalysisConfig}
              onRun={props.onAnalyze}
              onStop={props.onStop}
              onReset={props.onResetAnalysis}
              onTogglePromptSelection={props.onTogglePromptSelection}
              onSendToSoundGeneration={props.onSendToSoundGeneration}
              onAdvanceToSounds={handleUsageSendToSounds}
              expandedOriginalIndex={usageExpandedOriginalIndex}
              onExpandedOriginalIndexChange={setUsageExpandedOriginalIndex}
              activeContextOriginalIndex={activeContextOriginalIndex}
            />
          )}

          {currentStep === 2 && (
            <SoundGenerationSection
              soundConfigs={props.soundConfigs}
              activeSoundConfigTab={props.activeSoundConfigTab}
              isSoundGenerating={props.isSoundGenerating}
              soundGenError={props.soundGenError}
              generatedSounds={props.generatedSounds}
              globalDuration={props.globalDuration}
              globalSteps={props.globalSteps}
              globalNegativePrompt={props.globalNegativePrompt}
              applyDenoising={props.applyDenoising}
              trimSilence={props.trimSilence}
              applyNoiseReduction={props.applyNoiseReduction}
              audioModel={props.audioModel}
              onSetActiveTab={props.setActiveSoundConfigTab}
              onAddConfig={props.onAddSoundConfig}
              onBatchAddConfigs={props.onBatchAddSoundConfigs}
              onRemoveConfig={props.onRemoveSoundConfig}
              onUpdateConfig={props.onUpdateSoundConfig}
              onTypeChange={props.onSoundTypeChange}
              onGenerate={props.onGenerateSounds}
              onGenerateSingle={props.onGenerateSingleSound}
              onGenerateFiltered={props.onGenerateFilteredSounds}
              onStopGeneration={props.onStopSoundGeneration}
              onGlobalDurationChange={props.onGlobalDurationChange}
              onGlobalStepsChange={props.onGlobalStepsChange}
              onGlobalNegativePromptChange={props.onGlobalNegativePromptChange}
              onApplyDenoisingChange={props.onApplyDenoisingChange}
              onTrimSilenceChange={props.onTrimSilenceChange}
              onApplyNoiseReductionChange={props.onApplyNoiseReductionChange}
              onAudioModelChange={props.onAudioModelChange}
              onReprocessSounds={props.onReprocessSounds}
              onUploadAudio={props.onUploadAudio}
              onClearUploadedAudio={props.onClearUploadedAudio}
              onLibrarySearch={props.onLibrarySearch}
              onLibrarySoundSelect={props.onLibrarySoundSelect}
              modelEntities={props.modelEntities}
              onStartLinkingEntity={props.onStartLinkingEntity}
              onCancelLinkingEntity={props.onCancelLinkingEntity}
              onFinishLinkingEntity={props.onFinishLinkingEntity}
              onSelectLinkedEntity={props.onSelectLinkedEntity}
              onClearLinkedEntities={props.onClearLinkedEntities}
              isLinkingEntity={props.isLinkingEntity}
              linkingConfigIndex={props.linkingConfigIndex}
              useSpeckleViewer={props.useSpeckleViewer}
              onResetSound={props.onResetSound}
              onDuplicateConfig={props.onDuplicateConfig}
              onSelectSoundCard={props.onSelectSoundCard}
              selectedCardIndex={props.selectedCardIndex}
              onCatalogSoundSelect={props.onCatalogSoundSelect}
              visibleParentUsageIndex={activeUsageOriginalIndex}
            />
          )}
        </div>


      </aside>
    </>
  );
}



