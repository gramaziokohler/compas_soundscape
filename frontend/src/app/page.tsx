"use client";

import { useEffect, useState, useCallback } from "react";
import { ThreeScene } from "@/components/scene/ThreeScene";
import { Sidebar } from "@/components/layout/Sidebar";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useTextGeneration } from "@/hooks/useTextGeneration";
import { useSoundGeneration } from "@/hooks/useSoundGeneration";
import { useAudioControls } from "@/hooks/useAudioControls";
import { useAuralization } from "@/hooks/useAuralization";
import { useSED } from "@/hooks/useSED";
import { useReceivers } from "@/hooks/useReceivers";
import { apiService } from "@/services/api";
import { API_BASE_URL } from "@/lib/constants";
import type { LoadTab } from "@/types";

export default function Home() {
  const fileUpload = useFileUpload();
  const textGen = useTextGeneration(fileUpload.modelEntities, fileUpload.useModelAsContext);
  const soundGen = useSoundGeneration(fileUpload.geometryBounds);
  const audioControls = useAudioControls(soundGen.generatedSounds);
  const auralization = useAuralization();
  const sed = useSED();
  const receivers = useReceivers();
  const [activeLoadTab, setActiveLoadTab] = useState<LoadTab>('upload');

  // Load sounds from text generation into sound generation tab
  const handleLoadSoundsToGeneration = useCallback(() => {
    if (textGen.pendingSoundConfigs.length > 0) {
      soundGen.setSoundConfigsFromPrompts(textGen.pendingSoundConfigs);
      textGen.setActiveAiTab('sound');
      textGen.setPendingSoundConfigs([]);
    }
  }, [textGen.pendingSoundConfigs, soundGen, textGen]);

  // Handler: Analyze sound events when audio file is uploaded
  const handleAnalyzeSoundEvents = useCallback(async () => {
    if (!fileUpload.file) return;

    try {
      // Use numSounds from text generation settings
      await sed.analyzeSoundEvents(fileUpload.file, textGen.numSounds);
      console.log('✓ Sound event analysis complete');
    } catch (error) {
      console.error('Failed to analyze sound events:', error);
    }
  }, [fileUpload.file, textGen.numSounds, sed]);

  // Handler: Load detected sounds to sound generation tab
  const handleLoadSoundsFromSED = useCallback(() => {
    // Format SED results as sound configs
    const newConfigs = sed.formatForSoundGeneration();

    // Set the sound configs (replaces existing configs)
    soundGen.setSoundConfigsFromPrompts(newConfigs);

    // Switch to sound generation tab
    textGen.setActiveAiTab('sound');

    console.log(`Loaded ${newConfigs.length} sounds from SED analysis`);
  }, [sed, soundGen, textGen]);

  // Wrapped file change handler to clear SED results and load audio info
  const handleFileChangeWithSEDClear = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    fileUpload.handleFileChange(e);
    sed.clearSEDResults();

    // If it's an audio file, load its info immediately
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Check if it's an audio file by extension
      const isAudio = /\.(wav|mp3|flac|ogg|m4a|aac)$/i.test(selectedFile.name);
      if (isAudio) {
        await sed.loadAudioInfo(selectedFile);
      }
    }
  }, [fileUpload, sed]);

  // Handle sound deletion
  const handleDeleteSound = useCallback((soundId: string, promptIdx: number) => {
    if (!soundGen.soundscapeData) return;

    // Filter out all sounds with this prompt index
    const updatedSounds = soundGen.soundscapeData.filter(
      sound => (sound as any).prompt_index !== promptIdx
    );

    soundGen.setSoundscapeData(updatedSounds.length > 0 ? updatedSounds : null);
  }, [soundGen]);

  // Auralization handlers
  // Note: We don't use a separate AudioContext here. The Three.js scene creates its own
  // AudioContext via the AudioListener. The impulse response buffer will be loaded with
  // a temporary context and then used by Three.js's context (browser handles resampling).
  const handleLoadImpulseResponse = useCallback(async (file: File) => {
    console.log('[Auralization Page] handleLoadImpulseResponse called with:', file.name);
    try {
      // Use a temporary AudioContext for decoding - Three.js will use its own context
      const tempContext = new AudioContext();
      console.log('[Auralization Page] Created temp AudioContext, state:', tempContext.state);
      await auralization.loadImpulseResponse(file, tempContext);
      console.log('[Auralization Page] IR loaded successfully, will be used by Three.js AudioListener');
    } catch (error) {
      console.error('[Auralization Page] Error loading IR:', error);
    }
  }, [auralization]);

  // Cleanup on unmount
  useEffect(() => {
    apiService.cleanupGeneratedSounds();
    return () => {
      navigator.sendBeacon(`${API_BASE_URL}/api/cleanup-generated-sounds`);
    };
  }, []);

  return (
    <div className="flex w-screen h-screen overflow-hidden bg-gray-100 dark:bg-gray-900">
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
        useModelAsContext={fileUpload.useModelAsContext}
        onFileChange={handleFileChangeWithSEDClear}
        onDragOver={fileUpload.handleDragOver}
        onDragLeave={fileUpload.handleDragLeave}
        onDrop={fileUpload.handleDrop}
        onUpload={fileUpload.handleUpload}
        onLoadSampleIfc={fileUpload.handleLoadSampleIfc}
        onClearModel={fileUpload.clearModel}
        setUseModelAsContext={fileUpload.setUseModelAsContext}
        activeLoadTab={activeLoadTab}
        setActiveLoadTab={setActiveLoadTab}

        // SED props
        isSEDAnalyzing={sed.isSEDAnalyzing}
        sedAudioInfo={sed.sedAudioInfo}
        sedDetectedSounds={sed.sedDetectedSounds}
        sedError={sed.sedError}
        sedAnalysisOptions={sed.sedAnalysisOptions}
        onAnalyzeSoundEvents={handleAnalyzeSoundEvents}
        onToggleSEDOption={sed.toggleSEDOption}
        onLoadSoundsFromSED={handleLoadSoundsFromSED}

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
        globalDuration={soundGen.globalDuration}
        globalSteps={soundGen.globalSteps}
        globalNegativePrompt={soundGen.globalNegativePrompt}
        applyDenoising={soundGen.applyDenoising}
        setActiveSoundConfigTab={soundGen.setActiveSoundConfigTab}
        onAddSoundConfig={soundGen.handleAddConfig}
        onRemoveSoundConfig={soundGen.handleRemoveConfig}
        onUpdateSoundConfig={soundGen.handleUpdateConfig}
        onSoundModeChange={soundGen.handleModeChange}
        onGenerateSounds={soundGen.handleGenerate}
        onGlobalDurationChange={soundGen.handleGlobalDurationChange}
        onGlobalStepsChange={soundGen.handleGlobalStepsChange}
        onGlobalNegativePromptChange={soundGen.setGlobalNegativePrompt}
        onApplyDenoisingChange={soundGen.setApplyDenoising}
        onUploadAudio={soundGen.handleUploadAudio}
        onClearUploadedAudio={soundGen.handleClearUploadedAudio}
        onLibrarySearch={soundGen.handleLibrarySearch}
        onLibrarySoundSelect={soundGen.handleLibrarySoundSelect}

        // Audio controls props
        selectedVariants={audioControls.selectedVariants}

        // AI tab props
        activeAiTab={textGen.activeAiTab}
        setActiveAiTab={textGen.setActiveAiTab}

        // Soundscape data
        soundscapeData={soundGen.soundscapeData}

        // Auralization props
        auralizationConfig={auralization.config}
        auralizationLoading={auralization.isLoading}
        auralizationError={auralization.error}
        onToggleAuralization={auralization.toggleAuralization}
        onToggleNormalize={auralization.toggleNormalize}
        onLoadImpulseResponse={handleLoadImpulseResponse}
        onClearImpulseResponse={auralization.clearImpulseResponse}

        // Receiver props
        receivers={receivers.receivers}
        isPlacingReceiver={receivers.isPlacingReceiver}
        onStartPlacingReceiver={receivers.startPlacingReceiver}
        onDeleteReceiver={receivers.deleteReceiver}
        onUpdateReceiverName={receivers.updateReceiverName}
      />

      <main className="flex-1 overflow-hidden relative">
        <ThreeScene
          geometryData={fileUpload.geometryData}
          soundscapeData={soundGen.soundscapeData}
          individualSoundStates={audioControls.individualSoundStates}
          selectedVariants={audioControls.selectedVariants}
          soundVolumes={audioControls.soundVolumes}
          soundIntervals={audioControls.soundIntervals}
          onToggleSound={audioControls.toggleSound}
          onVariantChange={audioControls.handleVariantChange}
          onVolumeChange={audioControls.handleVolumeChange}
          onIntervalChange={audioControls.handleIntervalChange}
          onDeleteSound={handleDeleteSound}
          onPlayAll={audioControls.playAll}
          onPauseAll={audioControls.pauseAll}
          onStopAll={audioControls.stopAll}
          isAnyPlaying={audioControls.isAnyPlaying()}
          scaleForSounds={fileUpload.scaleForSounds}
          modelEntities={fileUpload.modelEntities}
          selectedDiverseEntities={textGen.selectedDiverseEntities}
          auralizationConfig={auralization.config}
          receivers={receivers.receivers}
          onUpdateReceiverPosition={receivers.updateReceiverPosition}
          onPlaceReceiver={receivers.placeReceiver}
          isPlacingReceiver={receivers.isPlacingReceiver}
          onCancelPlacingReceiver={receivers.cancelPlacingReceiver}
          className="w-full h-full"
        />
      </main>
    </div>
  );
}
