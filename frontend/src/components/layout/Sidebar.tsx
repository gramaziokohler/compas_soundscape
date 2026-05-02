"use client";

import { useState, useCallback, useEffect } from "react";
import Image from "next/image";
import { AnalysisSection } from "./sidebar/AnalysisSection";
import { SoundGenerationSection } from "./sidebar/SoundGenerationSection";
import { AcousticsSection } from "./sidebar/AcousticsSection";
import { ListenersSection } from "./sidebar/ListenersSection";
import { AdvancedSettingsSection } from "./sidebar/AdvancedSettingsSection";
import { VerticalTabButton } from "@/components/ui/VerticalTabButton";
import { Icon } from "@/components/ui/Icon";
import { UI_VERTICAL_TABS, UI_SIDEBAR_RESIZE } from "@/utils/constants";
import { useSidebarResize } from "@/hooks/useSidebarResize";
import { useTextGenerationStore } from "@/store/textGenerationStore";
import type { SidebarProps } from "@/types/components";
import type { ActiveTab } from "@/types";

export function Sidebar(props: SidebarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHandleHovered, setIsHandleHovered] = useState(false);

  // Expand sidebar when "Configure API tokens" is triggered from anywhere
  const tokenSettingsTrigger = useTextGenerationStore(s => s.tokenSettingsTrigger);
  useEffect(() => {
    if (tokenSettingsTrigger > 0) setIsExpanded(true);
  }, [tokenSettingsTrigger]);

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

  // Note: FilteringExtension colors are now auto-applied by the context
  // whenever linked objects or diverse selection changes - no tab dependency

  // Handle tab clicks: toggle collapse/expand when clicking active tab, or switch tabs
  const handleTabClick = useCallback((tab: ActiveTab) => {
    if (props.activeAiTab === tab) {
      // Clicking the same tab - toggle collapsed state
      setIsExpanded(prev => !prev);
    } else {
      // Clicking a different tab - switch to it and expand if collapsed
      props.setActiveAiTab(tab);
      if (!isExpanded) {
        setIsExpanded(true);
      }
    }
  }, [props.activeAiTab, props.setActiveAiTab, isExpanded]);

  return (
    <div className="fixed left-0 top-0 h-screen flex flex-row border-r border-secondary-light shadow-lg transition-all duration-300 ease-in-out z-10">
      {/* Vertical Tab Navigation */}
      <div
        className="flex-shrink-0 bg-secondary-lighter border-r border-secondary-light flex flex-col items-center pt-6 gap-1"
        style={{ width: `${UI_VERTICAL_TABS.WIDTH}px` }}
      >
        {/* Context Tab */}
        <VerticalTabButton
          icon={
            <Icon size={`${UI_VERTICAL_TABS.ICON_SIZE}px`} color="currentColor">
              {/* File Text Icon */}
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </Icon>
          }
          label="Context"
          isActive={props.activeAiTab === 'text'}
          onClick={() => handleTabClick('text')}
          buttonColor="var(--color-success)"
        />

        {/* Sounds Tab */}
        <VerticalTabButton
          icon={
            <Icon size={`${UI_VERTICAL_TABS.ICON_SIZE}px`} color="currentColor">
              {/* Volume 2 Icon */}
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </Icon>
          }
          label="Sounds"
          isActive={props.activeAiTab === 'sound'}
          onClick={() => handleTabClick('sound')}
        />

        {/* Listeners Tab */}
        <VerticalTabButton
          icon={
            <Icon size={`${UI_VERTICAL_TABS.ICON_SIZE}px`} color="currentColor">
              {/* Headphones / Listener Icon */}
              <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
              <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
            </Icon>
          }
          label="Listeners"
          isActive={props.activeAiTab === 'listeners'}
          onClick={() => handleTabClick('listeners')}
          buttonColor='var(--color-warning)'
        />

        {/* Acoustics Tab */}
        <VerticalTabButton
          icon={
            <Icon size={`${UI_VERTICAL_TABS.ICON_SIZE}px`} color="currentColor">
              {/* Radio Icon */}
              <circle cx="12" cy="12" r="2" />
              <path d="M16.24 7.76a6 6 0 0 1 0 8.49" />
              <path d="M7.76 16.24a6 6 0 0 1 0-8.49" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              <path d="M4.93 19.07a10 10 0 0 1 0-14.14" />
            </Icon>
          }
          label="Acoustics"
          isActive={props.activeAiTab === 'acoustics'}
          onClick={() => handleTabClick('acoustics')}
          buttonColor='var(--color-info)'
        />

        {/* Spacer - pushes settings to bottom */}
        <div className="flex-1" />

        {/* Settings Tab - Bottom */}
        <VerticalTabButton
          icon={
            <Icon size={`${UI_VERTICAL_TABS.ICON_SIZE}px`} color="currentColor">
              {/* Settings/Sliders Icon */}
              <path d="M4 21v-7" />
              <path d="M4 10V3" />
              <path d="M12 21v-9" />
              <path d="M12 8V3" />
              <path d="M20 21v-5" />
              <path d="M20 12V3" />
              <path d="M2 14h4" />
              <path d="M10 8h4" />
              <path d="M18 16h4" />
            </Icon>
          }
          label="Settings"
          isActive={props.activeAiTab === 'settings'}
          onClick={() => handleTabClick('settings')}
        />
      </div>

      {/* Main Content Area */}
      <aside
        className="flex-shrink-0 flex flex-col gap-4 bg-background transition-all duration-300 ease-in-out relative"
        style={{
          width: isExpanded ? `${contentWidth}px` : '0',
          padding: isExpanded ? '1.5rem 1rem' : '0',
          overflow: isExpanded ? 'auto' : 'hidden',
          opacity: isExpanded ? 0.95 : 0,
          userSelect: isResizing ? 'none' : undefined,
        }}
      >
        {/* Resize handle — right edge of the content panel */}
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
        {/* Fixed header - prevents wrapping issues
        <div className="flex items-center gap-4 flex-shrink-0 min-h-[50px]">
          <Image className="dark:invert flex-shrink-0" src="/compas_icon_white.png" alt="compas logo" width={50} height={50} priority />
        </div> */}

        {/* Generative AI Section with Tabs */}
        <div className="flex flex-col gap-4 w-full my-4">

        {/* Analysis Tab */}
        <div className="flex flex-col gap-4" style={{ display: props.activeAiTab === 'text' ? 'flex' : 'none' }}>
          <AnalysisSection
            analysisConfigs={props.analysisConfigs}
            activeTab={props.activeAnalysisTab}
            isRunning={props.isAnalyzing}
            error={props.analysisError}
            analysisResult={props.analysisResult}
            hasGlobalModelLoaded={props.hasGlobalModelLoaded}
            onAddConfig={props.onAddAnalysisConfig}
            onRemoveConfig={props.onRemoveAnalysisConfig}
            onUpdateConfig={props.onUpdateAnalysisConfig}
            onSetActiveTab={props.onSetActiveAnalysisTab}
            onRun={props.onAnalyze}
            onStop={props.onStop}
            onTogglePromptSelection={props.onTogglePromptSelection}
            onSendToSoundGeneration={props.onSendToSoundGeneration}
            onReset={props.onResetAnalysis}
          />
        </div>

        {/* Sound Generation Tab */}
        <div className="flex flex-col gap-4" style={{ display: props.activeAiTab === 'sound' ? 'flex' : 'none' }}>
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
            audioModel={props.audioModel}
            onSetActiveTab={props.setActiveSoundConfigTab}
            onAddConfig={props.onAddSoundConfig}
            onBatchAddConfigs={props.onBatchAddSoundConfigs}
            onRemoveConfig={props.onRemoveSoundConfig}
            onUpdateConfig={props.onUpdateSoundConfig}
            onTypeChange={props.onSoundTypeChange}
            onGenerate={props.onGenerateSounds}
            onStopGeneration={props.onStopSoundGeneration}
            onGlobalDurationChange={props.onGlobalDurationChange}
            onGlobalStepsChange={props.onGlobalStepsChange}
            onGlobalNegativePromptChange={props.onGlobalNegativePromptChange}
            onApplyDenoisingChange={props.onApplyDenoisingChange}
            onAudioModelChange={props.onAudioModelChange}
            onReprocessSounds={props.onReprocessSounds}
            onUploadAudio={props.onUploadAudio}
            onClearUploadedAudio={props.onClearUploadedAudio}
            onLibrarySearch={props.onLibrarySearch}
            onLibrarySoundSelect={props.onLibrarySoundSelect}
            modelEntities={props.modelEntities}
            onStartLinkingEntity={props.onStartLinkingEntity}
            onCancelLinkingEntity={props.onCancelLinkingEntity}
            isLinkingEntity={props.isLinkingEntity}
            linkingConfigIndex={props.linkingConfigIndex}
            useSpeckleViewer={props.useSpeckleViewer}
            onResetSound={props.onResetSound}
            onDuplicateConfig={props.onDuplicateConfig}
            onSelectSoundCard={props.onSelectSoundCard}
            selectedCardIndex={props.selectedCardIndex}
            onCatalogSoundSelect={props.onCatalogSoundSelect}                                        
          />
        </div>

        {/* Listeners Tab */}
        <div className="flex flex-col gap-4" style={{ display: props.activeAiTab === 'listeners' ? 'flex' : 'none' }}>
          <ListenersSection
            receivers={props.receivers}
            gridListeners={props.gridListeners}
            onAddReceiver={props.onAddReceiver}
            onDeleteReceiver={props.onDeleteReceiver}
            onUpdateReceiverName={props.onUpdateReceiverName}
            onUpdateReceiverPosition={props.onUpdateReceiverPosition}
            onGoToReceiver={props.onGoToReceiver}
            onToggleReceiverHiddenForSimulation={props.onToggleReceiverHiddenForSimulation}
            onAddGridListener={props.onAddGridListener}
            onDeleteGridListener={props.onDeleteGridListener}
            onComputeBounds={props.onComputeBounds}
            expandedGridListenerId={props.expandedGridListenerId}
            onExpandedGridListenerChange={props.onExpandedGridListenerChange}
            onExitFPS={props.onExitFPS}
            forcedExpandedId={props.forcedExpandedListenerId}
            collapseAllTrigger={props.collapseListenerCardTrigger}
          />
        </div>

        {/* Acoustics Tab */}
        <div style={{ display: props.activeAiTab === 'acoustics' ? 'block' : 'none' }}>
          <AcousticsSection
            onSelectIRFromLibrary={props.onSelectIRFromLibrary}
            onClearIR={props.onClearIR}
            selectedIRId={props.selectedIRId}
            auralizationConfig={props.auralizationConfig}
            resonanceAudioConfig={props.resonanceAudioConfig}
            onToggleResonanceAudio={props.onToggleResonanceAudio}
            onUpdateRoomMaterials={props.onUpdateRoomMaterials}
            hasGeometry={props.hasGeometry}
            showBoundingBox={props.showBoundingBox}
            onToggleBoundingBox={props.onToggleBoundingBox}
            onRefreshBoundingBox={props.onRefreshBoundingBox}
            roomScale={props.roomScale}
            onRoomScaleChange={props.onRoomScaleChange}
            audioRenderingMode={props.audioRenderingMode}
            onAudioRenderingModeChange={props.onAudioRenderingModeChange}
            modelEntities={props.modelEntities}
            modelType={props.modelType}
            geometryData={props.geometryData}
            selectedGeometry={props.selectedGeometry}
            onSelectGeometry={props.onSelectGeometry}
            onHoverGeometry={props.onHoverGeometry}
            onAssignMaterial={props.onAssignMaterial}
            modelFile={props.modelFile}
            speckleData={props.speckleData}
            soundscapeData={props.soundscapeData}
            onIRImported={props.onIRImported}
            irRefreshTrigger={props.irRefreshTrigger}
            simulationConfigs={props.simulationConfigs}
            activeSimulationIndex={props.activeSimulationIndex}
            onIRHover={props.onIRHover}
            onAddSimulationConfig={props.onAddSimulationConfig}
            onRemoveSimulationConfig={props.onRemoveSimulationConfig}
            onUpdateSimulationConfig={props.onUpdateSimulationConfig}
            onSetActiveSimulation={props.onSetActiveSimulation}
            onUpdateSimulationName={props.onUpdateSimulationName}
            onGoToReceiver={props.onGoToReceiver}
            fpsExitTrigger={props.collapseListenerCardTrigger}
            isFPSModeActive={props.isFPSModeActive}
            forcedActiveGroupId={props.forcedActiveGroupId}
          />
        </div>

        {/* Settings Tab */}
        <div className="flex flex-col gap-4" style={{ display: props.activeAiTab === 'settings' ? 'flex' : 'none' }}>
          <AdvancedSettingsSection
            globalDuration={props.globalDuration}
            globalSteps={props.globalSteps}
            globalNegativePrompt={props.globalNegativePrompt}
            applyDenoising={props.applyDenoising}
            normalizeImpulseResponses={props.normalizeImpulseResponses}
            audioModel={props.audioModel}
            llmModel={props.llmModel}
            onGlobalDurationChange={props.onGlobalDurationChange}
            onGlobalStepsChange={props.onGlobalStepsChange}
            onGlobalNegativePromptChange={props.onGlobalNegativePromptChange}
            onApplyDenoisingChange={props.onApplyDenoisingChange}
            onNormalizeImpulseResponsesChange={props.onNormalizeImpulseResponsesChange}
            onAudioModelChange={props.onAudioModelChange}
            onLlmModelChange={props.onLlmModelChange}
            onResetToDefaults={props.onResetAdvancedSettings}
            showAxesHelper={props.showAxesHelper}
            onShowAxesHelperChange={props.onShowAxesHelperChange}
            showLabelSprites={props.showLabelSprites}
            onShowLabelSpritesChange={props.onShowLabelSpritesChange}
            showHoveringHighlight={props.showHoveringHighlight}
            onShowHoveringHighlightChange={props.onShowHoveringHighlightChange}
            showSoundSpheres={props.showSoundSpheres}
            onShowSoundSpheresChange={props.onShowSoundSpheresChange}
            showSceneListeners={props.showSceneListeners}
            onShowSceneListenersChange={props.onShowSceneListenersChange}
            listenerOrientation={props.listenerOrientation}
            onListenerOrientationChange={props.onListenerOrientationChange}
          />
        </div>
      </div>
      </aside>
    </div>
  );
}
