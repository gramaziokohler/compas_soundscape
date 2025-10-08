"use client";

import { useEffect, useState, useCallback } from "react";
import { ThreeScene } from "@/components/scene/ThreeScene";
import { Sidebar } from "@/components/layout/Sidebar";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useTextGeneration } from "@/hooks/useTextGeneration";
import { useSoundGeneration } from "@/hooks/useSoundGeneration";
import { useAudioControls } from "@/hooks/useAudioControls";
import { apiService } from "@/services/api";
import { API_BASE_URL } from "@/lib/constants";
import type { LoadTab } from "@/types";

export default function Home() {
  const fileUpload = useFileUpload();
  const textGen = useTextGeneration(fileUpload.modelEntities);
  const soundGen = useSoundGeneration(fileUpload.geometryBounds);
  const audioControls = useAudioControls(soundGen.generatedSounds);
  const [activeLoadTab, setActiveLoadTab] = useState<LoadTab>('upload');

  // Load sounds from text generation into sound generation tab
  const handleLoadSoundsToGeneration = useCallback(() => {
    if (textGen.pendingSoundConfigs.length > 0) {
      soundGen.setSoundConfigsFromPrompts(textGen.pendingSoundConfigs);
      textGen.setActiveAiTab('sound');
      textGen.setPendingSoundConfigs([]);
    }
  }, [textGen.pendingSoundConfigs, soundGen, textGen]);

  // Cleanup on unmount
  useEffect(() => {
    apiService.cleanupGeneratedSounds();
    return () => {
      navigator.sendBeacon(`${API_BASE_URL}/api/cleanup-generated-sounds`);
    };
  }, []);

  return (
    <div className="flex w-screen h-screen bg-gray-100 dark:bg-gray-900">
      <Sidebar
        // File upload props
        file={fileUpload.file}
        geometryData={fileUpload.geometryData}
        uploadError={fileUpload.uploadError}
        isUploading={fileUpload.isUploading}
        isDragging={fileUpload.isDragging}
        modelEntities={fileUpload.modelEntities}
        isAnalyzingModel={fileUpload.isAnalyzingModel}
        analysisProgress={fileUpload.analysisProgress}
        onFileChange={fileUpload.handleFileChange}
        onDragOver={fileUpload.handleDragOver}
        onDragLeave={fileUpload.handleDragLeave}
        onDrop={fileUpload.handleDrop}
        onUpload={fileUpload.handleUpload}
        onLoadSampleIfc={fileUpload.handleLoadSampleIfc}
        onClearModel={fileUpload.clearModel}
        activeLoadTab={activeLoadTab}
        setActiveLoadTab={setActiveLoadTab}

        // Text generation props
        aiPrompt={textGen.aiPrompt}
        numSounds={textGen.numSounds}
        isGenerating={textGen.isGenerating}
        aiError={textGen.aiError}
        aiResponse={textGen.aiResponse}
        llmProgress={textGen.llmProgress}
        showConfirmLoadSounds={textGen.showConfirmLoadSounds}
        pendingSoundConfigs={textGen.pendingSoundConfigs}
        setAiPrompt={textGen.setAiPrompt}
        setNumSounds={textGen.setNumSounds}
        onGenerateText={textGen.handleGenerateText}
        onLoadSoundsToGeneration={handleLoadSoundsToGeneration}

        // Sound generation props
        soundConfigs={soundGen.soundConfigs}
        activeSoundConfigTab={soundGen.activeSoundConfigTab}
        isSoundGenerating={soundGen.isSoundGenerating}
        soundGenError={soundGen.soundGenError}
        generatedSounds={soundGen.generatedSounds}
        setActiveSoundConfigTab={soundGen.setActiveSoundConfigTab}
        onAddSoundConfig={soundGen.handleAddConfig}
        onRemoveSoundConfig={soundGen.handleRemoveConfig}
        onUpdateSoundConfig={soundGen.handleUpdateConfig}
        onGenerateSounds={soundGen.handleGenerate}

        // Audio controls props
        soundscapeState={audioControls.soundscapeState}
        selectedVariants={audioControls.selectedVariants}
        onPlayAll={audioControls.playAll}
        onPauseAll={audioControls.pauseAll}
        onStopAll={audioControls.stopAll}

        // AI tab props
        activeAiTab={textGen.activeAiTab}
        setActiveAiTab={textGen.setActiveAiTab}

        // Soundscape data
        soundscapeData={soundGen.soundscapeData}
      />

      <main className="flex-1">
        <ThreeScene
          geometryData={fileUpload.geometryData}
          soundscapeData={soundGen.soundscapeData}
          soundscapeState={audioControls.soundscapeState}
          individualSoundStates={audioControls.individualSoundStates}
          selectedVariants={audioControls.selectedVariants}
          onToggleSound={audioControls.toggleSound}
          onVariantChange={audioControls.handleVariantChange}
          scaleForSounds={fileUpload.scaleForSounds}
          className="w-full h-full"
        />
      </main>
    </div>
  );
}
