"use client";

import { useEffect, useState, useCallback } from "react";
import { ThreeScene } from "@/components/scene/ThreeScene";
import { Sidebar } from "@/components/layout/Sidebar";
import { IRStatusNotice } from "@/components/audio/IRStatusNotice";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useTextGeneration } from "@/hooks/useTextGeneration";
import { useSoundGeneration } from "@/hooks/useSoundGeneration";
import { useAudioControls } from "@/hooks/useAudioControls";
import { useAuralization } from "@/hooks/useAuralization";
import { useResonanceAudio } from "@/hooks/useResonanceAudio";
import { useSED } from "@/hooks/useSED";
import { useAudioOrchestrator } from "@/hooks/useAudioOrchestrator";
import { useReceivers } from "@/hooks/useReceivers";
import { useModalImpact } from "@/hooks/useModalImpact";
import { apiService } from "@/services/api";
import { API_BASE_URL } from "@/lib/constants";
import type { LoadTab } from "@/types";

export default function Home() {
  const fileUpload = useFileUpload();
  const textGen = useTextGeneration(fileUpload.modelEntities, fileUpload.useModelAsContext);
  const soundGen = useSoundGeneration(fileUpload.geometryBounds);
  const audioControls = useAudioControls(soundGen.generatedSounds);
  const auralization = useAuralization();
  const resonanceAudio = useResonanceAudio();
  const sed = useSED();

  // Audio Orchestrator (NEW)
  const audioOrchestrator = useAudioOrchestrator();
  const receivers = useReceivers();
  const modalImpact = useModalImpact();
  const [activeLoadTab, setActiveLoadTab] = useState<LoadTab>('upload');
  
  // IR Library state
  const [selectedIRId, setSelectedIRId] = useState<string | null>(null);
  
  // Bounding box visualization state
  const [showBoundingBox, setShowBoundingBox] = useState(false);
  const [refreshBoundingBoxTrigger, setRefreshBoundingBoxTrigger] = useState(0);
  
  // Entity linking state
  const [isLinkingEntity, setIsLinkingEntity] = useState(false);
  const [linkingConfigIndex, setLinkingConfigIndex] = useState<number | null>(null);

  // Handler: Refresh bounding box calculation from sound sources
  const handleRefreshBoundingBox = useCallback(() => {
    setRefreshBoundingBoxTrigger(prev => prev + 1);
    console.log('[Page] Triggering bounding box refresh');
  }, []);

  // Load sounds from text generation into sound generation tab
  const handleLoadSoundsToGeneration = useCallback(() => {
    if (textGen.pendingSoundConfigs.length > 0) {
      soundGen.setSoundConfigsFromPrompts(textGen.pendingSoundConfigs);
      textGen.setActiveAiTab('sound');
      // Don't clear pendingSoundConfigs - allow loading multiple times
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

  // Entity linking handlers
  const handleStartLinkingEntity = useCallback((configIndex: number) => {
    setIsLinkingEntity(true);
    setLinkingConfigIndex(configIndex);
  }, []);

  const handleCancelLinkingEntity = useCallback(() => {
    setIsLinkingEntity(false);
    setLinkingConfigIndex(null);
  }, []);

  const handleEntityLinked = useCallback((entity: any) => {
    if (linkingConfigIndex !== null) {
      const currentConfig = soundGen.soundConfigs[linkingConfigIndex];
      const previousEntity = currentConfig?.entity;

      // If entity is null (clicked on empty space)
      if (entity === null) {
        // If there's a currently linked entity, unlink it
        if (previousEntity) {
          soundGen.handleUpdateConfig(linkingConfigIndex, 'entity' as any, undefined);

          // Remove the previous entity from highlights
          const updatedEntities = textGen.selectedDiverseEntities.filter(
            e => e.index !== previousEntity.index
          );
          textGen.setSelectedDiverseEntities(updatedEntities);
        }

        // Exit linking mode (whether we unlinked or not)
        setIsLinkingEntity(false);
        setLinkingConfigIndex(null);
        return;
      }

      // Entity is not null - link the new entity
      soundGen.handleUpdateConfig(linkingConfigIndex, 'entity' as any, entity);

      // Update diverse selection to highlight the new entity
      let updatedEntities = [...textGen.selectedDiverseEntities];

      // Remove the previous entity from highlights if it exists
      if (previousEntity) {
        updatedEntities = updatedEntities.filter(e => e.index !== previousEntity.index);
      }

      // Add the new entity to highlights if not already present
      if (!updatedEntities.find(e => e.index === entity.index)) {
        updatedEntities.push(entity);
      }

      textGen.setSelectedDiverseEntities(updatedEntities);

      setIsLinkingEntity(false);
      setLinkingConfigIndex(null);
    }
  }, [linkingConfigIndex, soundGen, textGen]);

  /**
   * Wrapper for handleUpdateConfig that handles entity unlinking
   * When an entity is unlinked (set to undefined), also remove it from highlights
   */
  const handleUpdateSoundConfig = useCallback((index: number, field: string, value: any) => {
    // Check if we're unlinking an entity
    if (field === 'entity' && value === undefined) {
      const currentConfig = soundGen.soundConfigs[index];
      const previousEntity = currentConfig?.entity;

      // If there was a previous entity, remove it from highlights
      if (previousEntity) {
        const updatedEntities = textGen.selectedDiverseEntities.filter(
          e => e.index !== previousEntity.index
        );
        textGen.setSelectedDiverseEntities(updatedEntities);
      }
    }

    // Call the original handler
    soundGen.handleUpdateConfig(index, field, value);
  }, [soundGen, textGen]);

  /**
   * Handle selection of IR from server library
   * Downloads the IR and loads it into auralization AND audio orchestrator
   */
  const handleSelectIRFromLibrary = useCallback(async (irMetadata: any) => {
    try {
      // Build full URL (irMetadata.url is relative like "/static/impulse_responses/file.wav")
      const fullUrl = `${API_BASE_URL}${irMetadata.url}`;

      // Download the IR file from the server
      const response = await fetch(fullUrl);
      if (!response.ok) {
        throw new Error(`Failed to download IR: ${response.statusText}`);
      }

      const blob = await response.blob();
      const file = new File([blob], irMetadata.name, { type: 'audio/wav' });

      // Load the IR into OLD system (for compatibility)
      const tempContext = new AudioContext();
      await auralization.loadImpulseResponse(file, tempContext);

      // Load the IR into NEW audio orchestrator
      await audioOrchestrator.loadImpulseResponse?.(file);

      // Disable Resonance Audio when IR is loaded (as per workflow)
      if (resonanceAudio.config.enabled) {
        resonanceAudio.toggleResonanceAudio(false);
      }

      // Update selected IR ID
      setSelectedIRId(irMetadata.id);
    } catch (error) {
      console.error('[Auralization Page] Error loading IR from library:', error);
      throw error;
    }
  }, [auralization, audioOrchestrator]);

  /**
   * Clear/deselect the current IR (disable auralization)
   */
  const handleClearIR = useCallback(() => {
    auralization.clearImpulseResponse();
    audioOrchestrator.clearImpulseResponse?.();
    setSelectedIRId(null);
  }, [auralization, audioOrchestrator]);

  /**
   * Toggle IR normalization
   */
  const handleToggleNormalize = useCallback((enabled: boolean) => {
    auralization.toggleNormalize(enabled);
  }, [auralization]);

  // Handler: Update No IR Mode (Three.js vs Resonance)
  const handleUpdateNoIRMode = useCallback((mode: 'threejs' | 'resonance') => {
    audioOrchestrator.updateNoIRMode?.(mode);
  }, [audioOrchestrator]);

  // Handler: Update Output Decoder (Binaural vs Stereo)
  const handleUpdateOutputDecoder = useCallback((decoder: 'binaural' | 'stereo') => {
    const decoderType = decoder === 'binaural' ? 'binaural_hrtf' : 'stereo_speakers';
    audioOrchestrator.setOutputDecoder?.(decoderType as any);
  }, [audioOrchestrator]);

  // Cleanup on unmount
  useEffect(() => {
    apiService.cleanupGeneratedSounds();
    // Also cleanup impulse responses on page load/refresh
    fetch(`${API_BASE_URL}/api/impulse-responses`).then(async (response) => {
      if (response.ok) {
        const data = await response.json();
        // Delete all IRs on startup for clean state
        for (const ir of data.impulse_responses) {
          try {
            await apiService.deleteImpulseResponse(ir.id);
          } catch (error) {
            console.warn('Failed to cleanup IR:', ir.id, error);
          }
        }
      }
    }).catch(() => {
      // Ignore errors during cleanup
    });
    
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
        sedAudioBuffer={sed.sedAudioBuffer}
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
        onStopGeneration={textGen.handleStopGeneration}
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
        audioModel={soundGen.audioModel}
        setActiveSoundConfigTab={soundGen.setActiveSoundConfigTab}
        onAddSoundConfig={soundGen.handleAddConfig}
        onBatchAddSoundConfigs={soundGen.handleBatchAddConfigs}
        onRemoveSoundConfig={soundGen.handleRemoveConfig}
        onUpdateSoundConfig={handleUpdateSoundConfig}
        onSoundModeChange={soundGen.handleModeChange}
        onGenerateSounds={soundGen.handleGenerate}
        onStopSoundGeneration={soundGen.handleStopGeneration}
        onGlobalDurationChange={soundGen.handleGlobalDurationChange}
        onGlobalStepsChange={soundGen.handleGlobalStepsChange}
        onGlobalNegativePromptChange={soundGen.setGlobalNegativePrompt}
        onApplyDenoisingChange={soundGen.setApplyDenoising}
        onAudioModelChange={soundGen.setAudioModel}
        onReprocessSounds={soundGen.handleReprocessSounds}
        onUploadAudio={soundGen.handleUploadAudio}
        onClearUploadedAudio={soundGen.handleClearUploadedAudio}
        onLibrarySearch={soundGen.handleLibrarySearch}
        onLibrarySoundSelect={soundGen.handleLibrarySoundSelect}
        onStartLinkingEntity={handleStartLinkingEntity}
        onCancelLinkingEntity={handleCancelLinkingEntity}
        isLinkingEntity={isLinkingEntity}
        linkingConfigIndex={linkingConfigIndex}

        // Audio controls props
        selectedVariants={audioControls.selectedVariants}

        // AI tab props
        activeAiTab={textGen.activeAiTab}
        setActiveAiTab={textGen.setActiveAiTab}

        // Soundscape data
        soundscapeData={soundGen.soundscapeData}

        // IR Library props
        onSelectIRFromLibrary={handleSelectIRFromLibrary}
        onClearIR={handleClearIR}
        onToggleNormalize={handleToggleNormalize}
        selectedIRId={selectedIRId}
        auralizationConfig={auralization.config}

        // Receiver props
        receivers={receivers.receivers}
        isPlacingReceiver={receivers.isPlacingReceiver}
        onStartPlacingReceiver={receivers.startPlacingReceiver}
        onDeleteReceiver={receivers.deleteReceiver}
        onUpdateReceiverName={receivers.updateReceiverName}

        // Resonance Audio props
        resonanceAudioConfig={resonanceAudio.config}
        onToggleResonanceAudio={resonanceAudio.toggleResonanceAudio}
        onUpdateRoomMaterials={resonanceAudio.updateRoomMaterials}
        hasGeometry={fileUpload.geometryData !== null}
        showBoundingBox={showBoundingBox}
        onToggleBoundingBox={setShowBoundingBox}
        onRefreshBoundingBox={handleRefreshBoundingBox}

        // Audio Orchestrator props (NEW)
        preferredNoIRMode={audioOrchestrator.preferredNoIRMode}
        onUpdateNoIRMode={handleUpdateNoIRMode}
        outputDecoder={audioOrchestrator.outputDecoder === 'binaural_hrtf' ? 'binaural' : 'stereo'}
        onUpdateOutputDecoder={handleUpdateOutputDecoder}
      />

      <main className="flex-1 overflow-hidden relative">
        {/* IR Status Notice Overlay */}
        {audioOrchestrator.status?.uiNotice && (
          <IRStatusNotice
            message={audioOrchestrator.status.uiNotice}
            dofDescription={audioOrchestrator.status.dofDescription}
            isActive={audioOrchestrator.status.isIRActive}
          />
        )}

        <ThreeScene
          geometryData={fileUpload.geometryData}
          soundscapeData={soundGen.soundscapeData}
          individualSoundStates={audioControls.individualSoundStates}
          selectedVariants={audioControls.selectedVariants}
          soundVolumes={audioControls.soundVolumes}
          soundIntervals={audioControls.soundIntervals}
          mutedSounds={audioControls.mutedSounds}
          soloedSound={audioControls.soloedSound}
          onToggleSound={audioControls.toggleSound}
          onVariantChange={audioControls.handleVariantChange}
          onVolumeChange={audioControls.handleVolumeChange}
          onIntervalChange={audioControls.handleIntervalChange}
          onMute={audioControls.handleMute}
          onSolo={audioControls.handleSolo}
          onDeleteSound={handleDeleteSound}
          onPlayAll={audioControls.playAll}
          onPauseAll={audioControls.pauseAll}
          onStopAll={audioControls.stopAll}
          isAnyPlaying={audioControls.isAnyPlaying()}
          scaleForSounds={fileUpload.scaleForSounds}
          modelEntities={fileUpload.modelEntities}
          selectedDiverseEntities={textGen.selectedDiverseEntities}
          auralizationConfig={auralization.config}
          resonanceAudioConfig={resonanceAudio.config}
          geometryBounds={fileUpload.geometryBounds}
          showBoundingBox={showBoundingBox}
          refreshBoundingBoxTrigger={refreshBoundingBoxTrigger}
          receivers={receivers.receivers}
          onUpdateReceiverPosition={receivers.updateReceiverPosition}
          onPlaceReceiver={receivers.placeReceiver}
          isPlacingReceiver={receivers.isPlacingReceiver}
          onCancelPlacingReceiver={receivers.cancelPlacingReceiver}
          isLinkingEntity={isLinkingEntity}
          onEntityLinked={handleEntityLinked}
          modeVisualizationState={modalImpact.visualizationState}
          onSetModeVisualization={modalImpact.setModeVisualization}
          onSelectMode={modalImpact.selectMode}
          className="w-full h-full"
        />
      </main>
    </div>
  );
}
