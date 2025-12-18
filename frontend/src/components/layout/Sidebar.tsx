import Image from "next/image";
import { AnalysisSection } from "./sidebar/AnalysisSection";
import { SoundGenerationSection } from "./sidebar/SoundGenerationSection";
import { AcousticsTab } from "./sidebar/AcousticsTab";
import { useHorizontalScroll } from "@/hooks/useHorizontalScroll";
import { UI_COLORS } from "@/lib/constants";
import type { SidebarProps } from "@/types/components";

export function Sidebar(props: SidebarProps) {
  // Horizontal scroll for main tabs
  const mainTabsScrollRef = useHorizontalScroll<HTMLDivElement>();
  
  return (
    <aside className="w-96 flex-shrink-0 p-8 border-r border-gray-200 dark:border-gray-700 flex flex-col gap-8 shadow-lg bg-white dark:bg-gray-800 overflow-y-auto">
      {/* Fixed header - prevents wrapping issues */}
      <div className="flex items-center gap-4 flex-shrink-0 min-h-[50px]">
        <Image className="dark:invert flex-shrink-0" src="/compas_icon_white.png" alt="compas logo" width={50} height={50} priority />
        <h1 className="text-2xl font-bold whitespace-nowrap">COMPAS Soundscape</h1>
      </div>

      {/* Generative AI Section with Tabs */}
      <div className="flex flex-col gap-4 w-full">
        <h2 className="text-md font-regular">Soundscape driven architectural design</h2>

        {/* Tab Buttons - Horizontally scrollable without scrollbar */}
        <div ref={mainTabsScrollRef} className="overflow-x-auto scrollbar-hide border-b border-gray-300 dark:border-gray-600">
          <div className="flex gap-4 min-w-max">
            <button
              onClick={() => props.setActiveAiTab('text')}
              className="px-4 py-2 font-medium transition-colors whitespace-nowrap text-sm"
              style={{
                borderBottom: props.activeAiTab === 'text' ? `2px solid ${UI_COLORS.PRIMARY}` : 'none',
                color: props.activeAiTab === 'text' ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_600
              }}
              onMouseEnter={(e) => {
                if (props.activeAiTab !== 'text') {
                  e.currentTarget.style.color = UI_COLORS.NEUTRAL_900;
                }
              }}
              onMouseLeave={(e) => {
                if (props.activeAiTab !== 'text') {
                  e.currentTarget.style.color = UI_COLORS.NEUTRAL_600;
                }
              }}
            >
              Analysis
            </button>
            <button
              onClick={() => props.setActiveAiTab('sound')}
              className="px-4 py-2 font-medium transition-colors whitespace-nowrap text-sm"
              style={{
                borderBottom: props.activeAiTab === 'sound' ? `2px solid ${UI_COLORS.PRIMARY}` : 'none',
                color: props.activeAiTab === 'sound' ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_600
              }}
              onMouseEnter={(e) => {
                if (props.activeAiTab !== 'sound') {
                  e.currentTarget.style.color = UI_COLORS.NEUTRAL_900;
                }
              }}
              onMouseLeave={(e) => {
                if (props.activeAiTab !== 'sound') {
                  e.currentTarget.style.color = UI_COLORS.NEUTRAL_600;
                }
              }}
            >
              Soundscape
            </button>
            <button
              onClick={() => props.setActiveAiTab('acoustics')}
              className="px-4 py-2 font-medium transition-colors whitespace-nowrap text-sm"
              style={{
                borderBottom: props.activeAiTab === 'acoustics' ? `2px solid ${UI_COLORS.PRIMARY}` : 'none',
                color: props.activeAiTab === 'acoustics' ? UI_COLORS.PRIMARY : UI_COLORS.NEUTRAL_600
              }}
              onMouseEnter={(e) => {
                if (props.activeAiTab !== 'acoustics') {
                  e.currentTarget.style.color = UI_COLORS.NEUTRAL_900;
                }
              }}
              onMouseLeave={(e) => {
                if (props.activeAiTab !== 'acoustics') {
                  e.currentTarget.style.color = UI_COLORS.NEUTRAL_600;
                }
              }}
            >
              Acoustics
            </button>
          </div>
        </div>

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
      </div>

    </aside>
  );
}
