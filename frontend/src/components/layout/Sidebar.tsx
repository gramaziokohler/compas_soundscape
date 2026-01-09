import Image from "next/image";
import { AnalysisSection } from "./sidebar/AnalysisSection";
import { SoundGenerationSection } from "./sidebar/SoundGenerationSection";
import { AcousticsTab } from "./sidebar/AcousticsTab";
import { AdvancedSettingsSection } from "./sidebar/AdvancedSettingsSection";
import { VerticalTabButton } from "@/components/ui/VerticalTabButton";
import { Icon } from "@/components/ui/Icon";
import { UI_VERTICAL_TABS } from "@/lib/constants";
import type { SidebarProps } from "@/types/components";

export function Sidebar(props: SidebarProps) {
  return (
    <div className="flex flex-row h-full border-r border-gray-200 dark:border-gray-700 shadow-lg">
      {/* Vertical Tab Navigation */}
      <div
        className="flex-shrink-0 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col items-center pt-6 gap-1"
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
          onClick={() => props.setActiveAiTab('text')}
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
          onClick={() => props.setActiveAiTab('sound')}
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
          onClick={() => props.setActiveAiTab('acoustics')}
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
          onClick={() => props.setActiveAiTab('settings')}
        />
      </div>

      {/* Main Content Area */}
      <aside className="w-96 flex-shrink-0 px-6 py-8 flex flex-col gap-8 bg-white dark:bg-gray-800 overflow-y-auto">
        {/* Fixed header - prevents wrapping issues */}
        <div className="flex items-center gap-4 flex-shrink-0 min-h-[50px]">
          <Image className="dark:invert flex-shrink-0" src="/compas_icon_white.png" alt="compas logo" width={50} height={50} priority />
          <h1 className="text-2xl font-bold whitespace-nowrap">COMPAS Soundscape</h1>
        </div>

        {/* Generative AI Section with Tabs */}
        <div className="flex flex-col gap-4 w-full">


        {/* Analysis Tab */}
        <div className="flex flex-col gap-4" style={{ display: props.activeAiTab === 'text' ? 'flex' : 'none' }}>
          <AnalysisSection
            analysisConfigs={props.analysisConfigs}
            activeAnalysisTab={props.activeAnalysisTab}
            isAnalyzing={props.isAnalyzing}
            analysisError={props.analysisError}
            analysisResults={props.analysisResults}
            onAddConfig={props.onAddAnalysisConfig}
            onRemoveConfig={props.onRemoveAnalysisConfig}
            onUpdateConfig={props.onUpdateAnalysisConfig}
            onSetActiveTab={props.onSetActiveAnalysisTab}
            onAnalyze={props.onAnalyze}
            onStopAnalysis={props.onStopAnalysis}
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
            individualSoundStates={props.individualSoundStates}
            onToggleSound={props.onToggleSound}
            onVolumeChange={props.onVolumeChange}
            onIntervalChange={props.onIntervalChange}
            onMute={props.onMute}
            onSolo={props.onSolo}
            onVariantChange={props.onVariantChange}
            mutedSounds={props.mutedSounds}
            soloedSound={props.soloedSound}
            onResetSound={props.onResetSound}
            onSelectSoundCard={props.onSelectSoundCard}
            selectedCardIndex={props.selectedCardIndex}
            soundVolumes={props.soundVolumes}
            soundIntervals={props.soundIntervals}
            selectedVariants={props.selectedVariants}
            previewingSoundId={props.previewingSoundId}
            onPreviewPlayPause={props.onPreviewPlayPause}
            onPreviewStop={props.onPreviewStop}
            receivers={props.receivers}
            isPlacingReceiver={props.isPlacingReceiver}
            onStartPlacingReceiver={props.onStartPlacingReceiver}
            onDeleteReceiver={props.onDeleteReceiver}
            onUpdateReceiverName={props.onUpdateReceiverName}
            onGoToReceiver={props.onGoToReceiver}
          />
        </div>

        {/* Acoustics Tab */}
        <div style={{ display: props.activeAiTab === 'acoustics' ? 'block' : 'none' }}>
          <AcousticsTab
            receivers={props.receivers}
            isPlacingReceiver={props.isPlacingReceiver}
            onStartPlacingReceiver={props.onStartPlacingReceiver}
            onDeleteReceiver={props.onDeleteReceiver}
            onUpdateReceiverName={props.onUpdateReceiverName}
            onGoToReceiver={props.onGoToReceiver}
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
            soundscapeData={props.soundscapeData}
            onIRImported={props.onIRImported}
            irRefreshTrigger={props.irRefreshTrigger}
            simulationConfigs={props.simulationConfigs}
            activeSimulationIndex={props.activeSimulationIndex}
            expandedTabIndex={props.expandedTabIndex}
            onAddSimulationConfig={props.onAddSimulationConfig}
            onRemoveSimulationConfig={props.onRemoveSimulationConfig}
            onUpdateSimulationConfig={props.onUpdateSimulationConfig}
            onSetActiveSimulation={props.onSetActiveSimulation}
            onUpdateSimulationName={props.onUpdateSimulationName}
            onToggleExpandSimulation={props.onToggleExpandSimulation}
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
            onGlobalDurationChange={props.onGlobalDurationChange}
            onGlobalStepsChange={props.onGlobalStepsChange}
            onGlobalNegativePromptChange={props.onGlobalNegativePromptChange}
            onApplyDenoisingChange={props.onApplyDenoisingChange}
            onNormalizeImpulseResponsesChange={props.onNormalizeImpulseResponsesChange}
            onAudioModelChange={props.onAudioModelChange}
            onResetToDefaults={props.onResetAdvancedSettings}
            showAxesHelper={props.showAxesHelper}
            onShowAxesHelperChange={props.onShowAxesHelperChange}
          />
        </div>
      </div>
      </aside>
    </div>
  );
}
