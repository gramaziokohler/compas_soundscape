"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ContextSection } from "./sidebar/ContextSection";
import { UsageSection } from "./sidebar/UsageSection";
import { SoundGenerationSection } from "./sidebar/SoundGenerationSection";
import { UI_SIDEBAR_RESIZE, UI_SIDEBAR_TOGGLE } from "@/utils/constants";
import { readCssPx, clampToViewportWidth } from "@/utils/scale";
import { buildSidebarEdgeNotchClipPath } from "@/utils/sidebarEdgeNotch";
import { useSidebarResize } from "@/hooks/useSidebarResize";
import { useViewportScale } from "@/hooks/useViewportScale";
import { useIsMac } from "@/hooks/useIsMac";
import { formatShortcutKeys } from "@/utils/platform";
import { useTextGenerationStore } from "@/store/textGenerationStore";
import { useCardFlowStore } from "@/store/cardFlowStore";
import { useUIStore } from "@/store/uiStore";
import { useAnalysisStore, useSpeckleStore } from "@/store";
import { useAudioControlsStore } from "@/store/audioControlsStore";
import type { SidebarProps } from "@/types/components";
import type { AnalysisConfig } from "@/types/analysis";
import { CARD_TYPE_LABELS } from "@/types/card";
import type { CardType } from "@/types/card";

type Step = 0 | 1 | 2;

// ─── Module-level tooltip helpers ────────────────────────────────────────────

const SIDEBAR_CONTEXT_TYPES: CardType[] = ['model-analysis', 'audio', 'freeform'];
const SIDEBAR_USAGE_TYPES: CardType[] = ['scenario', 'text', 'freeform'];

function cardLabelHelper(config: any, fallback: string): string {
  if (!config) return fallback;
  if (config.display_name) return config.display_name;
  if (config.type === 'model-analysis' && config.analysisResult?.spaceTitle) return config.analysisResult.spaceTitle;
  if (config.audioFile?.name) return config.audioFile.name;
  if (config.modelFile?.name) return config.modelFile.name;
  return CARD_TYPE_LABELS[config.type as CardType] || fallback;
}

export function Sidebar(props: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentStep, setCurrentStepRaw] = useState<Step>(0);
  const [isHandleHovered, setIsHandleHovered] = useState(false);
  const [contextExpandedOriginalIndex, setContextExpandedOriginalIndex] = useState<number | null>(null);
  const [usageExpandedOriginalIndex, setUsageExpandedOriginalIndex] = useState<number | null>(null);
  const [bypassedUsage, setBypassedUsage] = useState(false);
  const [activeContextOriginalIndex, setActiveContextOriginalIndex] = useState<number | null>(null);
  const [activeUsageOriginalIndex, setActiveUsageOriginalIndex] = useState<number | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(true);
  const [shortcutsHovered, setShortcutsHovered] = useState(false);
  const isMac = useIsMac();

  // Restore the shortcuts-hints open/closed preference.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem('compas-sidebar-shortcuts-open');
      setShortcutsOpen(v === null ? true : v === 'true');
    } catch {
      /* ignore unavailable storage */
    }
  }, []);

  const setShortcutsOpenPersist = useCallback((open: boolean) => {
    setShortcutsOpen(open);
    try {
      window.localStorage.setItem('compas-sidebar-shortcuts-open', String(open));
    } catch {
      /* ignore unavailable storage */
    }
  }, []);

  // Guard ref that prevents advanceToUsage/advanceToSounds from firing
  // during initial load. ContextSection auto-advances when analysis configs
  // load asynchronously after mount, which would clobber the persisted step.
  const isInitializingRef = useRef(true);

  // Switching wizard steps (Context/Usage/Sounds) unmounts the outgoing section,
  // which destroys its WaveSurfer instance(s) — must stop any active preview
  // synchronously *before* that unmount so the still-registered instance gets
  // paused. A passive effect reacting to `currentStep` runs after the unmount
  // cleanup already deregistered the instance, too late to pause it reliably.
  const setCurrentStep = useCallback((step: Step) => {
    useAudioControlsStore.getState().stopSoundcardPreview();
    setCurrentStepRaw(step);
  }, []);

  // Trace currentStep changes for debugging refresh state
  useEffect(() => {
  }, [currentStep]);

  // After persist rehydration, pull the saved sidebar state from stores.
  // Falls back to direct localStorage read in case Zustand rehydrate hasn't completed yet.
  useEffect(() => {
    isInitializingRef.current = true;

    let sidebarExpanded: boolean | null = null;
    // Try direct localStorage first (most reliable, bypasses rehydrate timing)
    try {
      const raw = localStorage.getItem('compas-ui-state');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.state?.isLeftSidebarExpanded === 'boolean') {
          sidebarExpanded = parsed.state.isLeftSidebarExpanded;
        }
      }
    } catch {}
    if (sidebarExpanded === null) {
      sidebarExpanded = useUIStore.getState().isLeftSidebarExpanded;
    }
    setIsExpanded(sidebarExpanded);
    useUIStore.getState().setIsLeftSidebarExpanded(sidebarExpanded);

    const savedStep = useUIStore.getState().sidebarWizardStep;
    setCurrentStep(savedStep);
    const ctxIdx = useCardFlowStore.getState().activeContextOriginalIndex;
    setActiveContextOriginalIndex(ctxIdx);
    const usgIdx = useCardFlowStore.getState().activeUsageOriginalIndex;
    setActiveUsageOriginalIndex(usgIdx);
    if (savedStep === 0 && ctxIdx !== null) {
      setContextExpandedOriginalIndex(ctxIdx);
    } else if (savedStep === 1 && usgIdx !== null) {
      setUsageExpandedOriginalIndex(usgIdx);
    } else if (savedStep === 2) {
      if (usgIdx !== null) {
        useUIStore.getState().setActiveSoundParentIndex(usgIdx);
      } else {
        useUIStore.getState().setIsInSoundsStep(true);
      }
    }

    // Clear the initializing guard after a delay so ContextSection's
    // auto-advance can work normally for user-added cards after load.
    setTimeout(() => { isInitializingRef.current = false; }, 1000);
  }, []);

  // Sync currentStep → uiStore for refresh survival
  useEffect(() => {
    useUIStore.getState().setSidebarWizardStep(currentStep);
  }, [currentStep]);

  // Leaving Context unmounts AnalysisGroupColorSync; clear any single-group focus
  // set by AnalyzeModelResultContent so meshes don't stay highlighted in Usage.
  useEffect(() => {
    if (currentStep !== 0) {
      useSpeckleStore.getState().clearAnalysisObjectGroups();
    }
  }, [currentStep]);

  // Sync active context/usage indices → cardFlowStore for refresh survival
  useEffect(() => {
    useCardFlowStore.getState().setActiveContextOriginalIndex(activeContextOriginalIndex);
  }, [activeContextOriginalIndex]);
  useEffect(() => {
    useCardFlowStore.getState().setActiveUsageOriginalIndex(activeUsageOriginalIndex);
  }, [activeUsageOriginalIndex]);

  // Navigation never restores previous expansion state. When entering a section
  // we always expand a deterministic card: the first child when moving down,
  // or the corresponding parent card when moving back up.
  function getFirstContextIndex(): number | null {
    const idx = props.analysisConfigs.findIndex(
      (c) =>
        SIDEBAR_CONTEXT_TYPES.includes(c.type as CardType) &&
        !(c.type === 'freeform' && (c as any).parentContextOriginalIndex !== undefined)
    );
    return idx >= 0 ? idx : null;
  }

  function getFirstUsageChildIndex(parentContextIndex: number | null): number | null {
    const isUsage = (c: AnalysisConfig) =>
      SIDEBAR_USAGE_TYPES.includes(c.type as CardType) &&
      !(c.type === 'freeform' && (c as any).parentContextOriginalIndex === undefined);
    if (parentContextIndex === null) {
      const idx = props.analysisConfigs.findIndex(isUsage);
      return idx >= 0 ? idx : null;
    }
    const idx = props.analysisConfigs.findIndex(
      (c) => isUsage(c) && (c as any).parentContextOriginalIndex === parentContextIndex
    );
    return idx >= 0 ? idx : null;
  }

  // Breadcrumb labels derived reactively — ALL navigation paths update the same index
  // state, so labels are always consistent (FAB, breadcrumb click, or skip).
  // We replicate getCardDefaultName logic: display_name > LLM-generated space title
  // (model-analysis only) > file name > type label.
  function getConfigLabel(config: AnalysisConfig | undefined, fallback: string): string {
    if (!config) return fallback;
    if (config.display_name) return config.display_name;
    if (config.type === 'model-analysis' && (config as any).analysisResult?.spaceTitle) {
      return (config as any).analysisResult.spaceTitle;
    }
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
      hasInteractedRef.current = true;
      const parentIndex = useUIStore.getState().activeSoundParentIndex;
      if (parentIndex !== null) {
        // A specific parent was pre-set (e.g. during soundscape restore) —
        // sync the sidebar filter so only that parent's children are shown.
        if (parentIndex < 0) {
          // Audio context bypassed Usage
          const ctxIdx = -(parentIndex + 1);
          setActiveContextOriginalIndex(ctxIdx);
          setBypassedUsage(true);
        } else {
          // Normal usage parent — also sync the corresponding context parent
          setBypassedUsage(false);
          const usageCfg = props.analysisConfigs[parentIndex];
          if (usageCfg && (usageCfg as any).parentContextOriginalIndex !== undefined) {
            setActiveContextOriginalIndex((usageCfg as any).parentContextOriginalIndex);
          }
        }
        setActiveUsageOriginalIndex(parentIndex);
      } else {
        setActiveUsageOriginalIndex(null);
        setBypassedUsage(false);
      }
      useUIStore.getState().setIsInSoundsStep(true);
      setCurrentStep(2);
      setIsExpanded(true);
    }
  }, [props.stepAdvanceTrigger, props.analysisConfigs]);

  // Navigate to the Sounds step when a sim card requests it (SimulationSummaryBar).
  // Mirrors the stepAdvanceTrigger effect's parentless branch: no parent re-filtering.
  const soundsNavTrigger = useUIStore((s) => s.soundsNavTrigger);
  const prevSoundsNavTriggerRef = useRef(0);
  useEffect(() => {
    if (soundsNavTrigger > prevSoundsNavTriggerRef.current) {
      prevSoundsNavTriggerRef.current = soundsNavTrigger;
      hasInteractedRef.current = true;
      useUIStore.getState().setIsInSoundsStep(true);
      setCurrentStep(2);
      setIsExpanded(true);
    }
  }, [soundsNavTrigger]);

  // Sidebar width — fixed CSS px per resolution band (`--sidebar-*-width` in
  // globals.css), not a fraction of the viewport. Re-read when the viewport
  // crosses a breakpoint; overflowing the window is still clamped.
  const scale = useViewportScale();
  const sidebarMinWidth = readCssPx('--sidebar-min-width', UI_SIDEBAR_RESIZE.LEFT_MIN_WIDTH);
  const sidebarMaxWidth = clampToViewportWidth(
    readCssPx('--sidebar-max-width', UI_SIDEBAR_RESIZE.LEFT_MAX_WIDTH),
    sidebarMinWidth,
  );
  const sidebarDefaultWidth = clampToViewportWidth(
    readCssPx('--sidebar-default-width', UI_SIDEBAR_RESIZE.LEFT_DEFAULT_WIDTH),
    sidebarMinWidth,
  );

  const { width: contentWidth, isResizing, handleMouseDown: handleResizeMouseDown } = useSidebarResize({
    initialWidth: sidebarDefaultWidth,
    minWidth: sidebarMinWidth,
    maxWidth: sidebarMaxWidth,
    direction: 'right',
    onWidthChange: props.onWidthChange,
  });

  // Notify parent when expanded state changes
  useEffect(() => {
    props.onExpandedChange?.(isExpanded);
  }, [isExpanded, props.onExpandedChange]);

  // Report the initial content width once so consumers (e.g. the scene controls
  // hint) can position themselves correctly before the first resize drag.
  const reportedInitialWidthRef = useRef(false);
  useEffect(() => {
    if (reportedInitialWidthRef.current) return;
    reportedInitialWidthRef.current = true;
    props.onWidthChange?.(contentWidth);
  }, [contentWidth, props.onWidthChange]);

  // Step navigation helpers
  const advanceToUsage = useCallback((originalIndex: number, _title: string) => {
    if (isInitializingRef.current) {
      return;
    }
    hasInteractedRef.current = true;
    useCardFlowStore.getState().recordContextAdvance(originalIndex);
    setContextExpandedOriginalIndex(null);
    setActiveContextOriginalIndex(originalIndex);
    setBypassedUsage(false);
    useUIStore.getState().setActiveSoundParentIndex(null);
    setUsageExpandedOriginalIndex(getFirstUsageChildIndex(originalIndex));
    setCurrentStep(1);
    setIsExpanded(true);
  }, [props.analysisConfigs]);

  const handleContextSendToSounds = useCallback((originalIndex: number, title: string) => {
    if (isInitializingRef.current) {
      return;
    }
    hasInteractedRef.current = true;
    useCardFlowStore.getState().recordContextAdvance(originalIndex);
    setContextExpandedOriginalIndex(null);
    setActiveContextOriginalIndex(originalIndex);
    // Audio contexts get a real placeholder usage card as parent (created on
    // extraction), so extracted sounds filter under that usage card instead of
    // the old negative-namespace bypass key. The placeholder inherits the
    // audio context card's own title.
    const usageIdx = useAnalysisStore.getState().ensureUsageCardForContext(originalIndex, title);
    setBypassedUsage(false);
    setActiveUsageOriginalIndex(usageIdx);
    useUIStore.getState().setActiveSoundParentIndex(usageIdx);
    setCurrentStep(2);
    setIsExpanded(true);
  }, []);

  const handleUsageSendToSounds = useCallback((originalIndex: number, _title: string) => {
    if (isInitializingRef.current) {
      return;
    }
    hasInteractedRef.current = true;
    useCardFlowStore.getState().recordUsageAdvance(originalIndex);
    setUsageExpandedOriginalIndex(null);
    setActiveUsageOriginalIndex(originalIndex);
    setBypassedUsage(false);
    props.onSendToSoundGeneration(originalIndex);
    useUIStore.getState().setActiveSoundParentIndex(originalIndex);
    setCurrentStep(2);
    setIsExpanded(true);
  }, [props.onSendToSoundGeneration]);

  // ─── Breadcrumb parent resolution ─────────────────────────────────────────
  // Resolve an existing context card, or null when none is active/expanded.
  function findContextIndex(): number | null {
    if (
      contextExpandedOriginalIndex !== null &&
      contextExpandedOriginalIndex >= 0 &&
      contextExpandedOriginalIndex < props.analysisConfigs.length
    ) {
      const cfg = props.analysisConfigs[contextExpandedOriginalIndex];
      if (cfg && SIDEBAR_CONTEXT_TYPES.includes(cfg.type as CardType)) return contextExpandedOriginalIndex;
    }
    if (
      activeContextOriginalIndex !== null &&
      activeContextOriginalIndex !== undefined &&
      activeContextOriginalIndex >= 0 &&
      activeContextOriginalIndex < props.analysisConfigs.length
    ) {
      const cfg = props.analysisConfigs[activeContextOriginalIndex];
      if (cfg && SIDEBAR_CONTEXT_TYPES.includes(cfg.type as CardType)) return activeContextOriginalIndex;
    }
    return null;
  }

  // Appends a placeholder freeform context card and returns its new index.
  function createPlaceholderContext(): number {
    const nextIndex = props.analysisConfigs.length;
    props.onAddAnalysisConfig('freeform');
    props.onUpdateAnalysisConfig(nextIndex, { display_name: 'Untitled context' } as Partial<AnalysisConfig>);
    return nextIndex;
  }

  // Appends a placeholder freeform usage card linked to the context. `extraCreated`
  // accounts for a context placeholder created earlier in the same handler.
  function createPlaceholderUsage(contextIndex: number, extraCreated: number): number {
    const nextIndex = props.analysisConfigs.length + extraCreated;
    props.onAddAnalysisConfig('freeform');
    props.onUpdateAnalysisConfig(nextIndex, {
      display_name: 'Untitled usage',
      parentContextOriginalIndex: contextIndex,
    } as Partial<AnalysisConfig>);
    return nextIndex;
  }

  // ─── Load guard ────────────────────────────────────────────────────────────
  // True once the user has manually navigated anywhere — disables the load guard.
  const hasInteractedRef = useRef(false);
  // The load guard corrects the restored step at most once per mount.
  const parentGuardRanRef = useRef(false);

  // Validate that the restored section has a parent card; if not, step back to
  // the nearest parent section that does, ending at Context (step 0).
  const applyParentGuard = useCallback(() => {
    if (parentGuardRanRef.current) return;
    if (hasInteractedRef.current) return;

    let step: Step = currentStep;
    // Content-determined landing step on load/refresh: a model with no sound
    // cards always starts on the Usage section; if it has no usage cards
    // either, it starts on Context. Content is authoritative here — the
    // restored step may belong to a different model/session, so it is
    // overridden instead of validated.
    if (props.soundConfigs.length === 0) {
      step = getFirstUsageChildIndex(null) !== null ? 1 : 0;
    } else {
      // Validate that the restored section has a parent card; if not, step
      // back to the nearest parent section that does, ending at Context.
      if (step === 2) {
        const hasUsageParent =
          activeUsageOriginalIndex !== null &&
          activeUsageOriginalIndex !== undefined &&
          (activeUsageOriginalIndex < 0 ||
            (activeUsageOriginalIndex < props.analysisConfigs.length &&
              SIDEBAR_USAGE_TYPES.includes(props.analysisConfigs[activeUsageOriginalIndex]?.type as CardType)));
        if (!hasUsageParent) step = getFirstUsageChildIndex(null) !== null ? 1 : 0;
      }
      if (step === 1) {
        const hasContextParent =
          activeContextOriginalIndex !== null &&
          activeContextOriginalIndex !== undefined &&
          activeContextOriginalIndex < props.analysisConfigs.length &&
          SIDEBAR_CONTEXT_TYPES.includes(props.analysisConfigs[activeContextOriginalIndex]?.type as CardType);
        if (!hasContextParent) step = 0;
      }
    }

    // Step 0 (Context) is the root — no parent to validate. Skip without
    // consuming the guard so it can still run once the restored step lands.
    if (step === 0 && currentStep === 0) return;
    parentGuardRanRef.current = true;

    if (step !== currentStep) {
      setContextExpandedOriginalIndex(null);
      setUsageExpandedOriginalIndex(null);
      setBypassedUsage(false);
      useUIStore.getState().setActiveSoundParentIndex(null);
      useUIStore.getState().setIsInSoundsStep(false);
      if (step === 1) {
        const firstUsage = getFirstUsageChildIndex(null);
        if (firstUsage !== null) {
          const parentCtx = (props.analysisConfigs[firstUsage] as any).parentContextOriginalIndex;
          setActiveContextOriginalIndex(
            typeof parentCtx === 'number' && parentCtx < props.analysisConfigs.length ? parentCtx : getFirstContextIndex(),
          );
          setUsageExpandedOriginalIndex(firstUsage);
        } else {
          setActiveContextOriginalIndex(getFirstContextIndex());
        }
      } else {
        setActiveContextOriginalIndex(getFirstContextIndex());
      }
      setCurrentStep(step);
      setIsExpanded(true);
    }
  }, [currentStep, activeUsageOriginalIndex, activeContextOriginalIndex, props.analysisConfigs, props.soundConfigs]);

  // Run the guard once restored data is available and before user interaction.
  // Run the guard once restored data is available and before user interaction.
  // Also run it for a model that has loaded with no cards at all — otherwise an
  // empty model restored on the Sounds step would stay on Sounds forever.
  useEffect(() => {
    if (parentGuardRanRef.current || hasInteractedRef.current) return;
    const modelLoaded = props.hasGlobalModelLoaded;
    if (props.analysisConfigs.length === 0 && props.soundConfigs.length === 0 && !modelLoaded) return;
    applyParentGuard();
  }, [props.analysisConfigs, props.soundConfigs, props.hasGlobalModelLoaded, applyParentGuard]);

  // ─── Breadcrumb click handlers ─────────────────────────────────────────────
  // Go to the Sounds section, recursively creating placeholder parent cards
  // (context → usage) when the chain does not exist yet.
  const handleSoundsBreadcrumbClick = useCallback(() => {
    hasInteractedRef.current = true;

    // Resolve the target context first. Prefer the expanded usage card's parent
    // when already at Usage, then the expanded/active context, then create a
    // placeholder context when none exists.
    let ctxIdx = findContextIndex();
    let extraCreated = 0;
    if (
      currentStep === 1 &&
      usageExpandedOriginalIndex !== null &&
      usageExpandedOriginalIndex >= 0 &&
      usageExpandedOriginalIndex < props.analysisConfigs.length
    ) {
      const parentCtx = (props.analysisConfigs[usageExpandedOriginalIndex] as any).parentContextOriginalIndex;
      if (typeof parentCtx === 'number' && parentCtx >= 0 && parentCtx < props.analysisConfigs.length) {
        ctxIdx = parentCtx;
      }
    }
    if (ctxIdx === null) {
      ctxIdx = createPlaceholderContext();
      extraCreated = 1;
    }

    setContextExpandedOriginalIndex(null);
    setUsageExpandedOriginalIndex(null);
    setIsExpanded(true);

    const ctxCfg = props.analysisConfigs[ctxIdx];
    if (ctxCfg?.type === 'audio') {
      // Audio contexts get a real placeholder usage card as parent (created on
      // extraction), so extracted sounds filter under that usage card. The
      // placeholder inherits the audio context card's own title.
      const usageIdx = useAnalysisStore.getState().ensureUsageCardForContext(
        ctxIdx,
        getConfigLabel(ctxCfg, CARD_TYPE_LABELS['audio']),
      );
      setActiveContextOriginalIndex(ctxIdx);
      setBypassedUsage(false);
      setActiveUsageOriginalIndex(usageIdx);
      useUIStore.getState().setActiveSoundParentIndex(usageIdx);
    } else {
      // The usage parent is scoped to THIS context only — a usage card belonging
      // to another context must never be reused (independent trees). Prefer the
      // currently expanded usage card (the one whose child count the Sounds
      // breadcrumb is showing) over a previously-active sibling, then the
      // last-active usage, then the first usage of this context.
      const isThisContextsUsage = (c: AnalysisConfig) =>
        SIDEBAR_USAGE_TYPES.includes(c.type as CardType) &&
        !(c.type === 'freeform' && (c as any).parentContextOriginalIndex === undefined) &&
        (c as any).parentContextOriginalIndex === ctxIdx;
      let usageIdx: number | null = null;
      if (
        currentStep === 1 &&
        usageExpandedOriginalIndex !== null &&
        usageExpandedOriginalIndex >= 0 &&
        usageExpandedOriginalIndex < props.analysisConfigs.length &&
        isThisContextsUsage(props.analysisConfigs[usageExpandedOriginalIndex])
      ) {
        usageIdx = usageExpandedOriginalIndex;
      } else if (
        activeUsageOriginalIndex !== null &&
        activeUsageOriginalIndex !== undefined &&
        activeUsageOriginalIndex >= 0 &&
        activeUsageOriginalIndex < props.analysisConfigs.length &&
        isThisContextsUsage(props.analysisConfigs[activeUsageOriginalIndex])
      ) {
        usageIdx = activeUsageOriginalIndex;
      } else {
        const existingUsage = props.analysisConfigs.findIndex(isThisContextsUsage);
        usageIdx = existingUsage >= 0 ? existingUsage : createPlaceholderUsage(ctxIdx, extraCreated);
      }
      setActiveContextOriginalIndex(ctxIdx);
      setBypassedUsage(false);
      setActiveUsageOriginalIndex(usageIdx);
      useUIStore.getState().setActiveSoundParentIndex(usageIdx);
    }
    setCurrentStep(2);
  }, [currentStep, usageExpandedOriginalIndex, activeUsageOriginalIndex, contextExpandedOriginalIndex, activeContextOriginalIndex, props.analysisConfigs, props.onAddAnalysisConfig, props.onUpdateAnalysisConfig]);

  // Go to the Usage section, creating a placeholder context parent when none
  // exists. Audio contexts land on their placeholder usage card (created on
  // extraction), so the breadcrumb is clickable for them too.
  // Rule: we expand the first child when moving down, or the corresponding parent card when moving back up.
  const handleUsageBreadcrumbClick = useCallback(() => {
    hasInteractedRef.current = true;

    let targetUsageIdx: number | null = null;
    let ctxIdx: number | null = null;

    // Moving back up from Sounds (step 2): expand the corresponding parent card (activeUsageOriginalIndex)
    if (
      currentStep > 1 &&
      activeUsageOriginalIndex !== null &&
      activeUsageOriginalIndex >= 0 &&
      activeUsageOriginalIndex < props.analysisConfigs.length
    ) {
      const usageCfg = props.analysisConfigs[activeUsageOriginalIndex];
      if (usageCfg && SIDEBAR_USAGE_TYPES.includes(usageCfg.type as CardType)) {
        targetUsageIdx = activeUsageOriginalIndex;
        const parentCtx = (usageCfg as any)?.parentContextOriginalIndex;
        if (typeof parentCtx === 'number' && parentCtx >= 0 && parentCtx < props.analysisConfigs.length) {
          ctxIdx = parentCtx;
        }
      }
    }

    if (ctxIdx === null) {
      ctxIdx = findContextIndex();
    }
    if (ctxIdx === null) {
      ctxIdx = createPlaceholderContext();
    }

    // Moving down (from Context, step 0) or fallback: expand the first child
    if (targetUsageIdx === null) {
      targetUsageIdx = getFirstUsageChildIndex(ctxIdx);
    }

    setActiveContextOriginalIndex(ctxIdx);
    setContextExpandedOriginalIndex(null);
    setBypassedUsage(false);
    useUIStore.getState().setActiveSoundParentIndex(null);
    useUIStore.getState().setIsInSoundsStep(false);
    setUsageExpandedOriginalIndex(targetUsageIdx);
    setCurrentStep(1);
    setIsExpanded(true);
  }, [
    currentStep,
    activeUsageOriginalIndex,
    contextExpandedOriginalIndex,
    activeContextOriginalIndex,
    props.analysisConfigs,
    props.onAddAnalysisConfig,
    props.onUpdateAnalysisConfig,
  ]);

  // ─── Breadcrumb "has cards" state ───────────────────────────────────────────
  // A breadcrumb is greyed (but still clickable) when its section contains no
  // cards, evaluated relative to the currently expanded/active parent card.
  const contextBreadcrumbHasCards = getFirstContextIndex() !== null;

  const usageBreadcrumbHasCards = (() => {
    if (currentStep === 0) {
      return getFirstUsageChildIndex(contextExpandedOriginalIndex) !== null;
    }
    if (activeContextOriginalIndex !== null && activeContextOriginalIndex !== undefined) {
      return getFirstUsageChildIndex(activeContextOriginalIndex) !== null;
    }
    return getFirstUsageChildIndex(null) !== null;
  })();

  const soundsBreadcrumbHasCards = (() => {
    if (props.soundConfigs.length === 0) return false;
    // At Context step: scope to the expanded context's subtree only.
    if (
      currentStep === 0 &&
      contextExpandedOriginalIndex !== null &&
      contextExpandedOriginalIndex < props.analysisConfigs.length
    ) {
      const ctxCfg = props.analysisConfigs[contextExpandedOriginalIndex];
      if (ctxCfg?.type === 'audio') {
        const audioKey = -(contextExpandedOriginalIndex + 1);
        return props.soundConfigs.some((s) => s.parentUsageOriginalIndex === audioKey);
      }
      return props.soundConfigs.some((s) => {
        const uIdx = s.parentUsageOriginalIndex;
        if (uIdx === null || uIdx === undefined || uIdx < 0) return false;
        const usg = props.analysisConfigs[uIdx];
        return !!usg && (usg as any).parentContextOriginalIndex === contextExpandedOriginalIndex;
      });
    }
    // At Usage step: scope to the expanded usage card.
    if (
      currentStep === 1 &&
      usageExpandedOriginalIndex !== null &&
      usageExpandedOriginalIndex >= 0 &&
      usageExpandedOriginalIndex < props.analysisConfigs.length
    ) {
      return props.soundConfigs.some((s) => s.parentUsageOriginalIndex === usageExpandedOriginalIndex);
    }
    return props.soundConfigs.length > 0;
  })();

  // ─── Breadcrumb "blue link" child-count state ──────────────────────────────
  // While a parent card is expanded, its immediate child section's breadcrumb
  // turns into a blue clickable link carrying a count badge — but only scoped
  // to THIS parent's children (not the whole section), and only while that
  // parent is the one currently expanded.
  const usageChildCountForExpandedContext =
    currentStep === 0 && contextExpandedOriginalIndex !== null
      ? props.analysisConfigs.filter(
          (c) =>
            SIDEBAR_USAGE_TYPES.includes(c.type as CardType) &&
            (c as any).parentContextOriginalIndex === contextExpandedOriginalIndex,
        ).length
      : 0;

  // Sounds badge at the Context step: aggregate the sound cards of ALL child
  // usage/scenario cards of the expanded context (not the whole project, and not
  // just one scenario). Mirrors `soundsBreadcrumbHasCards`' scoping, including
  // the legacy negative key used by audio contexts that bypassed Usage.
  const soundChildCountForExpandedContext = (() => {
    if (currentStep !== 0 || contextExpandedOriginalIndex === null) return 0;
    const ctxCfg = props.analysisConfigs[contextExpandedOriginalIndex];
    if (ctxCfg?.type === 'audio') {
      const audioKey = -(contextExpandedOriginalIndex + 1);
      return props.soundConfigs.filter((s) => s.parentUsageOriginalIndex === audioKey).length;
    }
    return props.soundConfigs.filter((s) => {
      const uIdx = s.parentUsageOriginalIndex;
      if (uIdx === null || uIdx === undefined || uIdx < 0) return false;
      const usg = props.analysisConfigs[uIdx];
      return !!usg && (usg as any).parentContextOriginalIndex === contextExpandedOriginalIndex;
    }).length;
  })();

  const soundChildCountForExpandedUsage =
    currentStep === 1 && usageExpandedOriginalIndex !== null
      ? props.soundConfigs.filter((s) => s.parentUsageOriginalIndex === usageExpandedOriginalIndex).length
      : 0;

  const usageBreadcrumbBlue = usageChildCountForExpandedContext > 0;
  const soundsBreadcrumbBlue = soundChildCountForExpandedContext > 0 || soundChildCountForExpandedUsage > 0;
  const soundsBreadcrumbCount =
    currentStep === 0 ? soundChildCountForExpandedContext : soundChildCountForExpandedUsage;

  // Toggle handle geometry — the button always sits a fixed margin to the
  // right of the sidebar's edge, in both states (never flush on top of it).
  // When expanded, the sidebar's own edge gets a smooth inward notch near
  // the button (see sidebarEdgeNotch.ts) instead of a hard straight border.
  const toggleEdgeX = isExpanded ? contentWidth - UI_SIDEBAR_TOGGLE.MARGIN * 1.5 : 0;
  const toggleCenterX = toggleEdgeX + UI_SIDEBAR_TOGGLE.MARGIN + UI_SIDEBAR_TOGGLE.DIAMETER / 2;
  const sidebarEdgeClipPath = isExpanded
    ? buildSidebarEdgeNotchClipPath(
        contentWidth,
        scale.viewport.height,
        'right',
        scale.viewport.height / 2,
        UI_SIDEBAR_TOGGLE.NOTCH_HEIGHT,
        UI_SIDEBAR_TOGGLE.NOTCH_DEPTH,
      )
    : undefined;

  return (
    <>
      {/* Toggle handle — a soft circular button offset from the sidebar edge */}
      <div
        className="group"
        style={{
          position: 'fixed',
          left: `${toggleCenterX}px`,
          top: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 15,
          transition: 'left 300ms ease-in-out',
        }}
      >
        <button
          onClick={() => { const v = !isExpanded;  setIsExpanded(v); useUIStore.getState().setIsLeftSidebarExpanded(v); }}
          title={isExpanded ? 'Collapse panel' : 'Open panel'}
          style={{ width: `${UI_SIDEBAR_TOGGLE.DIAMETER}px`, height: `${UI_SIDEBAR_TOGGLE.DIAMETER}px` }}
          className={`sidebar-toggle-handle backdrop-blur-lg backdrop-saturate-150 ${!isExpanded ? 'sidebar-toggle-handle--bounce' : 'sidebar-toggle-handle--expanded'}`}
        >
          <svg width={UI_SIDEBAR_TOGGLE.ICON_WIDTH} height={UI_SIDEBAR_TOGGLE.ICON_HEIGHT} viewBox="0 0 10 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            {isExpanded ? (
              <path d="M7 3L2 8L7 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M3 3L8 8L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </button>
        {!isExpanded && (
          <span
            style={{ left: `calc(100% + ${UI_SIDEBAR_TOGGLE.LABEL_OFFSET}px)`, top: '50%', transform: 'translateY(-50%)' }}
            className="sidebar-toggle-label backdrop-blur-lg backdrop-saturate-150 absolute opacity-0 group-hover:opacity-100 transition-opacity select-none pointer-events-none"
          >
            Soundscape
          </span>
        )}
      </div>

      {/* Sidebar content panel */}
      <aside
        data-sidebar="left"
        className="fixed top-0 left-0 h-screen flex flex-col transition-all duration-300 ease-in-out"
        style={{
          width: isExpanded ? `${contentWidth}px` : '0px',
          opacity: isExpanded ? 1 : 0,
          zIndex: 10,
          userSelect: isResizing ? 'none' : undefined,
        }}
      >
        {/* clip-path lives on the blur layer itself, not the <aside> — a
            clip-path on an ancestor of a backdrop-filter element breaks the
            backdrop blur in Chromium, so the notch shape must be applied
            directly to the element that carries the blur. */}
        <div
          className="sidebar-glass backdrop-blur-lg backdrop-saturate-150"
          style={{ clipPath: sidebarEdgeClipPath }}
          aria-hidden="true"
        />
        <div className="relative z-[1] flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden">
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
            {/* Context step — always clickable */}
            <button
              className={`transition-colors flex-1 min-w-0 truncate ${
                currentStep === 0
                  ? 'bg-primary text-on-blue px-0.5 py-0.5'
                  : contextBreadcrumbHasCards
                  ? 'text-adaptive hover:bg-secondary-light cursor-pointer'
                  : 'text-adaptive opacity-80 hover:bg-secondary-light cursor-pointer'
              }`}
              onClick={() => {
                hasInteractedRef.current = true;
                setUsageExpandedOriginalIndex(null);
                let targetContextIdx =
                  activeContextOriginalIndex !== null &&
                  activeContextOriginalIndex >= 0 &&
                  activeContextOriginalIndex < props.analysisConfigs.length
                    ? activeContextOriginalIndex
                    : null;
                if (targetContextIdx === null) {
                  const refUsageIdx = currentStep === 1 ? usageExpandedOriginalIndex : activeUsageOriginalIndex;
                  if (refUsageIdx !== null && refUsageIdx >= 0 && refUsageIdx < props.analysisConfigs.length) {
                    const parentCtx = (props.analysisConfigs[refUsageIdx] as any)?.parentContextOriginalIndex;
                    if (typeof parentCtx === 'number' && parentCtx >= 0 && parentCtx < props.analysisConfigs.length) {
                      targetContextIdx = parentCtx;
                    }
                  }
                }
                const resolvedContext = targetContextIdx !== null ? targetContextIdx : getFirstContextIndex();
                setContextExpandedOriginalIndex(resolvedContext);
                setActiveContextOriginalIndex(resolvedContext);
                setBypassedUsage(false);
                useUIStore.getState().setActiveSoundParentIndex(null);
                useUIStore.getState().setIsInSoundsStep(false);
                setCurrentStep(0);
                setIsExpanded(true);
              }}
              aria-current={currentStep === 0 ? 'step' : undefined}
              title={contextTooltip}
            >
              {contextBreadcrumbLabel}
            </button>
            <span className="text-adaptive opacity-80 shrink-0" aria-hidden="true">›</span>
            {/* Usage step — always clickable; audio contexts land on their placeholder usage card.
                Badge lives in this wrapper (not inside the `truncate`/overflow-hidden button)
                so it isn't clipped by the button's own bounds. */}
            <div className="relative flex-1 min-w-0">
              <button
                className={`transition-colors w-full min-w-0 truncate ${
                  currentStep === 1
                    ? 'bg-primary text-on-blue px-0.5 py-0.5'
                    : usageBreadcrumbBlue
                    ? 'text-blue-text hover:bg-secondary-light cursor-pointer'
                    : usageBreadcrumbHasCards
                    ? 'text-adaptive hover:bg-secondary-light cursor-pointer'
                    : 'text-adaptive opacity-80 hover:bg-secondary-light cursor-pointer'
                }`}
                onClick={handleUsageBreadcrumbClick}
                aria-current={currentStep === 1 ? 'step' : undefined}
                title={usageTooltip}
              >
                {usageBreadcrumbLabel}
              </button>
              {usageBreadcrumbBlue && (
                <span className="absolute -top-1.5 -right-1.5 z-10 min-w-[14px] h-[14px] px-[3px] rounded-full bg-primary text-on-blue text-[8px] font-bold flex items-center justify-center leading-none pointer-events-none">
                  {usageChildCountForExpandedContext}
                </span>
              )}
            </div>
            <span className="text-adaptive opacity-80 shrink-0" aria-hidden="true">›</span>
            {/* Sounds step — always clickable; creates placeholder parent cards when needed */}
            <div className="relative flex-1 min-w-0">
              <button
                id="sidebar-sounds-breadcrumb"
                className={`transition-colors w-full min-w-0 truncate ${
                  currentStep === 2
                    ? 'bg-primary text-on-blue px-0.5 py-0.5'
                    : soundsBreadcrumbBlue
                    ? 'text-blue-text hover:bg-secondary-light cursor-pointer'
                    : soundsBreadcrumbHasCards
                    ? 'text-adaptive hover:bg-secondary-light cursor-pointer'
                    : 'text-adaptive opacity-80 hover:bg-secondary-light cursor-pointer'
                }`}
                onClick={() => {
                  handleSoundsBreadcrumbClick();
                }}
                aria-current={currentStep === 2 ? 'step' : undefined}
                title={soundsTooltip}
              >
                Sounds
              </button>
              {soundsBreadcrumbBlue && (
                <span className="absolute -top-1.5 -right-1.5 z-10 min-w-[14px] h-[14px] px-[3px] rounded-full bg-primary text-on-blue text-[8px] font-bold flex items-center justify-center leading-none pointer-events-none">
                  {soundsBreadcrumbCount}
                </span>
              )}
            </div>
          </nav>
        </div>

        {/* Scrollable step content */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {currentStep === 0 && (
            <ContextSection
              analysisConfigs={props.analysisConfigs}
              isRunning={props.isAnalyzing}
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
              onRegenerateSingle={props.onRegenerateSingle}
              onDeleteVariant={props.onDeleteVariant}
              onSelectSoundCard={props.onSelectSoundCard}
              selectedCardIndex={props.selectedCardIndex}
              onSoundCardCollapsed={props.onSoundCardCollapsed}
              onCatalogSoundSelect={props.onCatalogSoundSelect}
              visibleParentUsageIndex={activeUsageOriginalIndex}
            />
          )}
        </div>

        {/* Shortcut hints — very bottom of the sidebar (collapsible) */}
        <div className="flex-shrink-0 px-4 pt-2 pb-3 border-t border-secondary-light">
          {shortcutsOpen ? (
            <div
              onMouseEnter={() => setShortcutsHovered(true)}
              onMouseLeave={() => setShortcutsHovered(false)}
              className="flex flex-col gap-0.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase tracking-wider text-secondary-hover">Shortcuts</span>
                {shortcutsHovered && (
                  <button
                    onClick={() => setShortcutsOpenPersist(false)}
                    aria-label="Hide shortcuts"
                    title="Hide shortcuts"
                    className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[10px] leading-none text-secondary-hover hover:text-foreground transition-colors"
                  >
                    ×
                  </button>
                )}
              </div>
              {[
                { label: 'Duplicate', command: 'Ctrl + drag' },
                { label: 'Card options', command: 'Right-click' },
                ...(currentStep === 2 ? [{ label: 'Zoom into sound sphere', command: 'Double-click' }] : []),
              ].map((row) => (
                <div key={row.label} className="flex items-baseline gap-1.5 text-[9px] leading-tight">
                  <span className="font-medium text-foreground">{row.label}</span>
                  <span className="text-secondary-hover">{formatShortcutKeys(row.command, isMac)}</span>
                </div>
              ))}
            </div>
          ) : (
            <button
              onClick={() => setShortcutsOpenPersist(true)}
              className="text-[9px] text-secondary-hover hover:text-foreground transition-colors cursor-pointer"
            >
              Shortcuts
            </button>
          )}
        </div>
        </div>
      </aside>
    </>
  );
}



