import Image from "next/image";
import { ModelLoadSection } from "./sidebar/ModelLoadSection";
import { TextGenerationSection } from "./sidebar/TextGenerationSection";
import { SoundGenerationSection } from "./sidebar/SoundGenerationSection";
import { AcousticsTab } from "./sidebar/AcousticsTab";
import type { SidebarProps } from "@/types/components";

export function Sidebar(props: SidebarProps) {
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
        <div className="overflow-x-auto scrollbar-hide border-b border-gray-300 dark:border-gray-600">
          <div className="flex gap-2 min-w-max">
            <button
              onClick={() => props.setActiveAiTab('text')}
              className={`px-5 py-2 font-medium transition-colors whitespace-nowrap text-sm ${
                props.activeAiTab === 'text'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Analysis
            </button>
            <button
              onClick={() => props.setActiveAiTab('sound')}
              className={`px-5 py-2 font-medium transition-colors whitespace-nowrap text-sm ${
                props.activeAiTab === 'sound'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Sound Generation
            </button>
            <button
              onClick={() => props.setActiveAiTab('acoustics')}
              className={`px-5 py-2 font-medium transition-colors whitespace-nowrap text-sm ${
                props.activeAiTab === 'acoustics'
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Acoustics
            </button>
          </div>
        </div>

        {/* Text Generation Tab */}
        {props.activeAiTab === 'text' && (
          <div className="flex flex-col gap-4">
            <ModelLoadSection
              modelEntities={props.modelEntities}
              activeLoadTab={props.activeLoadTab}
              file={props.file}
              isDragging={props.isDragging}
              isUploading={props.isUploading}
              isAnalyzingModel={props.isAnalyzingModel}
              uploadError={props.uploadError}
              analysisProgress={props.analysisProgress}
              useModelAsContext={props.useModelAsContext}
              onFileChange={props.onFileChange}
              onDragOver={props.onDragOver}
              onDragLeave={props.onDragLeave}
              onDrop={props.onDrop}
              onUpload={props.onUpload}
              onLoadSampleIfc={props.onLoadSampleIfc}
              onClearModel={props.onClearModel}
              setActiveLoadTab={props.setActiveLoadTab}
              setUseModelAsContext={props.setUseModelAsContext}
              isSEDAnalyzing={props.isSEDAnalyzing}
              sedAudioInfo={props.sedAudioInfo}
              sedDetectedSounds={props.sedDetectedSounds}
              sedError={props.sedError}
              sedAnalysisOptions={props.sedAnalysisOptions}
              onAnalyzeSoundEvents={props.onAnalyzeSoundEvents}
              onToggleSEDOption={props.onToggleSEDOption}
              onLoadSoundsFromSED={props.onLoadSoundsFromSED}
            />

            <TextGenerationSection
              modelEntities={props.modelEntities}
              aiPrompt={props.aiPrompt}
              numSounds={props.numSounds}
              isGenerating={props.isGenerating}
              isAnalyzingModel={props.isAnalyzingModel}
              llmProgress={props.llmProgress}
              aiError={props.aiError}
              aiResponse={props.aiResponse}
              showConfirmLoadSounds={props.showConfirmLoadSounds}
              analysisProgress={props.analysisProgress}
              setAiPrompt={props.setAiPrompt}
              setNumSounds={props.setNumSounds}
              onGenerateText={props.onGenerateText}
              onLoadSoundsToGeneration={props.onLoadSoundsToGeneration}
            />
          </div>
        )}

        {/* Sound Generation Tab */}
        {props.activeAiTab === 'sound' && (
          <div className="flex flex-col gap-4">
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
              onSetActiveTab={props.setActiveSoundConfigTab}
              onAddConfig={props.onAddSoundConfig}
              onRemoveConfig={props.onRemoveSoundConfig}
              onUpdateConfig={props.onUpdateSoundConfig}
              onModeChange={props.onSoundModeChange}
              onGenerate={props.onGenerateSounds}
              onGlobalDurationChange={props.onGlobalDurationChange}
              onGlobalStepsChange={props.onGlobalStepsChange}
              onGlobalNegativePromptChange={props.onGlobalNegativePromptChange}
              onApplyDenoisingChange={props.onApplyDenoisingChange}
              onUploadAudio={props.onUploadAudio}
              onClearUploadedAudio={props.onClearUploadedAudio}
              onLibrarySearch={props.onLibrarySearch}
              onLibrarySoundSelect={props.onLibrarySoundSelect}
            />
          </div>
        )}

        {/* Acoustics Tab */}
        {props.activeAiTab === 'acoustics' && (
          <AcousticsTab
            receivers={props.receivers}
            isPlacingReceiver={props.isPlacingReceiver}
            onStartPlacingReceiver={props.onStartPlacingReceiver}
            onDeleteReceiver={props.onDeleteReceiver}
            onUpdateReceiverName={props.onUpdateReceiverName}
            auralizationConfig={props.auralizationConfig}
            auralizationLoading={props.auralizationLoading}
            auralizationError={props.auralizationError}
            onToggleAuralization={props.onToggleAuralization}
            onToggleNormalize={props.onToggleNormalize}
            onLoadImpulseResponse={props.onLoadImpulseResponse}
            onClearImpulseResponse={props.onClearImpulseResponse}
          />
        )}
      </div>

    </aside>
  );
}
