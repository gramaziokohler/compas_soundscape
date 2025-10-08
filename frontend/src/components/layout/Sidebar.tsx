import Image from "next/image";
import { ModelLoadSection } from "./sidebar/ModelLoadSection";
import { TextGenerationSection } from "./sidebar/TextGenerationSection";
import { SoundGenerationSection } from "./sidebar/SoundGenerationSection";
import { ControlsInfo } from "./sidebar/ControlsInfo";
import type {
  CompasGeometry,
  SoundEvent,
  SoundGenerationConfig,
  ActiveTab,
  LoadTab,
  SoundState
} from "@/types";

interface SidebarProps {
  file: File | null;
  geometryData: CompasGeometry | null;
  soundscapeData: SoundEvent[] | null;
  soundscapeState: SoundState;
  selectedVariants: {[key: number]: number};
  activeAiTab: ActiveTab;
  activeLoadTab: LoadTab;
  modelEntities: any[];
  aiPrompt: string;
  numSounds: number;
  soundConfigs: SoundGenerationConfig[];
  activeSoundConfigTab: number;
  generatedSounds: any[];
  isUploading: boolean;
  isAnalyzingModel: boolean;
  isGenerating: boolean;
  isSoundGenerating: boolean;
  isDragging: boolean;
  uploadError: string | null;
  aiError: string | null;
  soundGenError: string | null;
  aiResponse: string | null;
  analysisProgress: string;
  llmProgress: string;
  showConfirmLoadSounds: boolean;
  pendingSoundConfigs: any[];
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onUpload: () => void;
  onLoadSampleIfc: () => void;
  onClearModel: () => void;
  setActiveAiTab: (tab: ActiveTab) => void;
  setActiveLoadTab: (tab: LoadTab) => void;
  setAiPrompt: (prompt: string) => void;
  setNumSounds: (num: number) => void;
  onGenerateText: () => void;
  onLoadSoundsToGeneration: () => void;
  setActiveSoundConfigTab: (tab: number) => void;
  onAddSoundConfig: () => void;
  onRemoveSoundConfig: (index: number) => void;
  onUpdateSoundConfig: (index: number, field: keyof SoundGenerationConfig, value: string | number) => void;
  onGenerateSounds: () => void;
  onPlayAll: () => void;
  onPauseAll: () => void;
  onStopAll: () => void;
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside className="w-96 flex-shrink-0 p-8 border-r border-gray-200 dark:border-gray-700 flex flex-col gap-8 shadow-lg bg-white dark:bg-gray-800 overflow-y-auto">
      <div className="flex items-center gap-4">
        <Image className="dark:invert" src="/compas_icon_white.png" alt="compas logo" width={50} height={50} priority />
        <h1 className="text-2xl font-bold">COMPAS Soundscape</h1>
      </div>

      {/* Generative AI Section with Tabs */}
      <div className="flex flex-col gap-4 w-full">
        <h2 className="text-md font-regular">Populate your architectural model with contextualized sound events</h2>

        {/* Tab Buttons */}
        <div className="flex gap-2 border-b border-gray-300 dark:border-gray-600">
          <button
            onClick={() => props.setActiveAiTab('text')}
            className={`px-4 py-2 font-medium transition-colors ${
              props.activeAiTab === 'text'
                ? 'border-b-2 border-[#F500B8] text-[#F500B8]'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Text Generation
          </button>
          <button
            onClick={() => props.setActiveAiTab('sound')}
            className={`px-4 py-2 font-medium transition-colors ${
              props.activeAiTab === 'sound'
                ? 'border-b-2 border-[#F500B8] text-[#F500B8]'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Sound Generation
          </button>
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
              onFileChange={props.onFileChange}
              onDragOver={props.onDragOver}
              onDragLeave={props.onDragLeave}
              onDrop={props.onDrop}
              onUpload={props.onUpload}
              onLoadSampleIfc={props.onLoadSampleIfc}
              onClearModel={props.onClearModel}
              setActiveLoadTab={props.setActiveLoadTab}
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
          <SoundGenerationSection
            soundConfigs={props.soundConfigs}
            activeSoundConfigTab={props.activeSoundConfigTab}
            isSoundGenerating={props.isSoundGenerating}
            soundGenError={props.soundGenError}
            generatedSounds={props.generatedSounds}
            soundscapeState={props.soundscapeState}
            onSetActiveTab={props.setActiveSoundConfigTab}
            onAddConfig={props.onAddSoundConfig}
            onRemoveConfig={props.onRemoveSoundConfig}
            onUpdateConfig={props.onUpdateSoundConfig}
            onGenerate={props.onGenerateSounds}
            onPlayAll={props.onPlayAll}
            onPauseAll={props.onPauseAll}
            onStopAll={props.onStopAll}
          />
        )}
      </div>

      {/* Controls Info */}
      {(props.geometryData || props.soundscapeData) && <ControlsInfo />}
    </aside>
  );
}
