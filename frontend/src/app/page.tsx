"use client";

import { useEffect, useState, useCallback } from "react";
import { ThreeScene } from "@/components/scene/ThreeScene";
import { Sidebar } from "@/components/layout/Sidebar";
import { IRStatusNotice } from "@/components/audio/IRStatusNotice";
import { ErrorProvider } from "@/contexts/ErrorContext";
import { ErrorToast } from "@/components/ui/ErrorToast";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useTextGeneration } from "@/hooks/useTextGeneration";
import { useSoundGeneration } from "@/hooks/useSoundGeneration";
import { useAudioControls } from "@/hooks/useAudioControls";
import { useAudioNormalization } from "@/hooks/useAudioNormalization";
import { useRoomMaterials } from "@/hooks/useRoomMaterials";
import { useSED } from "@/hooks/useSED";
import { useAudioOrchestrator } from "@/hooks/useAudioOrchestrator";
import { useReceivers } from "@/hooks/useReceivers";
import { useModalImpact } from "@/hooks/useModalImpact";
import { apiService } from "@/services/api";
import { API_BASE_URL } from "@/lib/constants";
import type { LoadTab, SoundGenerationConfig } from "@/types";
import type { SelectedGeometry, AcousticMaterial } from "@/types/materials";
import { AudioStatusDisplay } from "@/components/audio/AudioStatusDisplay";
import type { AudioRenderingMode } from "@/components/audio/AudioRenderingModeSelector";

function HomeContent() {
  const fileUpload = useFileUpload();
  const textGen = useTextGeneration(fileUpload.modelEntities, fileUpload.useModelAsContext);
  const soundGen = useSoundGeneration(fileUpload.geometryBounds);
  const audioControls = useAudioControls(soundGen.generatedSounds);

  const sed = useSED();

  // MAIN AUDIO SYSTEM: Handles all 6 audio modes (Flat Anechoic, ShoeBox Acoustics, Spatial Anechoic, Mono IR, Stereo IR, Ambisonic IR)
  const audioOrchestrator = useAudioOrchestrator();

  // Audio feature hooks (modular, integrate with orchestrator)
  const audioNormalization = useAudioNormalization(audioOrchestrator.orchestrator);
  const roomMaterials = useRoomMaterials(audioOrchestrator.orchestrator);
  const receivers = useReceivers();
  const modalImpact = useModalImpact();
  const [activeLoadTab, setActiveLoadTab] = useState<LoadTab>('upload');
  
  // IR Library state - store both ID and full metadata for reload capability
  const [selectedIRId, setSelectedIRId] = useState<string | null>(null);
  const [selectedIRMetadata, setSelectedIRMetadata] = useState<any | null>(null);
  const [irRefreshTrigger, setIrRefreshTrigger] = useState(0);

  // Bounding box visualization state
  const [showBoundingBox, setShowBoundingBox] = useState(false);
  const [refreshBoundingBoxTrigger, setRefreshBoundingBoxTrigger] = useState(0);
  
  // Audio rendering mode state (unified: threejs, resonance, anechoic)
  const [audioRenderingMode, setAudioRenderingMode] = useState<AudioRenderingMode>('anechoic');
  
  // Sync audioRenderingMode with orchestrator only when IR state changes
  useEffect(() => {
    if (!audioOrchestrator.status) return;

    const isIRActive = audioOrchestrator.status.isIRActive;

    // When IR becomes active, force to 'precise' mode
    if (isIRActive && audioRenderingMode !== 'precise') {
      setAudioRenderingMode('precise');
    }
    // Note: Don't override user's selection of 'precise' when no IR is loaded
    // They may be about to upload an IR
  }, [audioOrchestrator.status?.isIRActive]);

  // Auto-hide bounding box when not in ResonanceMode
  useEffect(() => {
    if (!audioOrchestrator.status) return;

    const currentMode = audioOrchestrator.status.currentMode;

    // Only show bounding box in ResonanceMode (no_ir_resonance)
    if (currentMode !== 'no_ir_resonance' && showBoundingBox) {
      setShowBoundingBox(false);
    }
  }, [audioOrchestrator.status?.currentMode, showBoundingBox]);
  
  // Entity linking state
  const [isLinkingEntity, setIsLinkingEntity] = useState(false);
  const [linkingConfigIndex, setLinkingConfigIndex] = useState<number | null>(null);
  const [selectedCardIndex, setSelectedCardIndex] = useState<number | null>(null);

  // Material assignment state (NEW)
  const [selectedGeometry, setSelectedGeometry] = useState<SelectedGeometry | null>(null);
  const [modelType, setModelType] = useState<'3dm' | 'obj' | 'ifc' | null>(null);

  // Detect model type from file extension
  useEffect(() => {
    if (fileUpload.modelFile) {
      const fileName = fileUpload.modelFile.name.toLowerCase();
      if (fileName.endsWith('.3dm')) {
        setModelType('3dm');
      } else if (fileName.endsWith('.obj')) {
        setModelType('obj');
      } else if (fileName.endsWith('.ifc')) {
        setModelType('ifc');
      } else {
        setModelType(null);
      }
    } else {
      setModelType(null);
    }
  }, [fileUpload.modelFile]);

  // Clear analyzed entities when model changes
  useEffect(() => {
    // Clear the analysis when new model is loaded or model is unloaded
    textGen.handleClearAnalysis();
  }, [fileUpload.modelFile, fileUpload.modelEntities.length]);

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
    if (!fileUpload.audioFile) return;

    try {
      // Use numSounds from text generation settings
      await sed.analyzeSoundEvents(fileUpload.audioFile, textGen.numSounds);
      console.log('✓ Sound event analysis complete');
    } catch (error) {
      console.error('Failed to analyze sound events:', error);
    }
  }, [fileUpload.audioFile, textGen.numSounds, sed]);

  // Handler: Load detected sounds to sound generation tab
  const handleLoadSoundsFromSED = useCallback(() => {
    // Format SED results as sound configs
    const newConfigs = sed.formatForSoundGeneration();

    // Add the sound configs (appends to existing configs)
    soundGen.setSoundConfigsFromPrompts(newConfigs);

    // Switch to sound generation tab
    textGen.setActiveAiTab('sound');

    console.log(`Loaded ${newConfigs.length} sounds from SED analysis`);
  }, [sed, soundGen, textGen]);

  // Wrapped file change handler to clear SED results and load audio info
  const handleFileChangeWithSEDClear = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    fileUpload.handleFileChange(e);

    // Only clear SED results if it's an audio file (to replace previous audio)
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      // Check if it's an audio file by extension
      const isAudio = /\.(wav|mp3|flac|ogg|m4a|aac)$/i.test(selectedFile.name);
      if (isAudio) {
        sed.clearSEDResults();
        await sed.loadAudioInfo(selectedFile);
      }
    }
  }, [fileUpload, sed]);

  // Auto-load model when modelFile changes
  useEffect(() => {
    if (fileUpload.modelFile && !fileUpload.isUploading && !fileUpload.geometryData) {
      fileUpload.handleUploadModel();
    }
  }, [fileUpload.modelFile, fileUpload.isUploading, fileUpload.geometryData]);

  // Handle sound deletion
  const handleDeleteSound = useCallback((soundId: string, promptIdx: number) => {
    if (!soundGen.soundscapeData) return;

    // Filter out all sounds with this prompt index
    const updatedSounds = soundGen.soundscapeData.filter(
      sound => (sound as any).prompt_index !== promptIdx
    );

    soundGen.setSoundscapeData(updatedSounds.length > 0 ? updatedSounds : null);
  }, [soundGen]);

  // Handle sound reset (remove generated sound but keep config)
  const handleResetSound = useCallback((soundId: string, promptIndex: number) => {

    // Use functional setState to avoid stale closure issues
    soundGen.setSoundscapeData(prev => {
      if (!prev) {
        return prev;
      }

      // Filter out sounds with this prompt index
      const updatedSounds = prev.filter(
        sound => (sound as any).prompt_index !== promptIndex
      );

      return updatedSounds.length > 0 ? updatedSounds : null;
    });

    // Reset the sound config atomically (clears display_name, uploaded audio, library search, etc.)
    soundGen.handleResetSoundConfig(promptIndex);
  }, [soundGen.setSoundscapeData, soundGen.handleResetSoundConfig]);

  // Handle sound card selection from ThreeScene
  const handleSelectSoundCard = useCallback((promptIndex: number) => {
    // Switch to Soundscape tab if not already there
    textGen.setActiveAiTab('sound');
    // Trigger expansion of the corresponding sound card
    setSelectedCardIndex(promptIndex);
  }, [textGen.setActiveAiTab]);

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
          // Detach sound from entity (creates sound sphere, updates soundscapeData)
          soundGen.handleDetachSoundFromEntity(linkingConfigIndex);

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
      // This will destroy sound sphere (if exists) and move overlay to entity
      soundGen.handleAttachSoundToEntity(linkingConfigIndex, entity);

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
   * Toggle entity in diverse selection (for LLM prompts)
   * Used from entity overlay link button: grey <-> pink
   */
  const handleToggleDiverseSelection = useCallback((entity: any) => {
    const isCurrentlySelected = textGen.selectedDiverseEntities.some(e => e.index === entity.index);

    if (isCurrentlySelected) {
      // Remove from selection
      const updatedEntities = textGen.selectedDiverseEntities.filter(e => e.index !== entity.index);
      textGen.setSelectedDiverseEntities(updatedEntities);
    } else {
      // Add to selection
      textGen.setSelectedDiverseEntities([...textGen.selectedDiverseEntities, entity]);
    }
  }, [textGen]);

  /**
   * Detach sound from entity and create sound sphere
   * Used from entity overlay link button when clicking green (linked) state
   */
  const handleDetachSound = useCallback((entity: any) => {
    // Find the config linked to this entity
    const configIndex = soundGen.soundConfigs.findIndex(config => config.entity?.index === entity.index);

    if (configIndex === -1) {
      console.warn('[handleDetachSound] No sound config found for entity', entity.index);
      return;
    }

    // Unlink the entity from the sound config AND update soundscape data
    // This will create a sound sphere in ThreeScene
    soundGen.handleDetachSoundFromEntity(configIndex);

    // Add entity to diverse selection (pink highlight)
    if (!textGen.selectedDiverseEntities.some(e => e.index === entity.index)) {
      textGen.setSelectedDiverseEntities([...textGen.selectedDiverseEntities, entity]);
    }
  }, [soundGen, textGen]);

  /**
   * Wrapper for handleUpdateConfig that handles entity unlinking
   * When an entity is unlinked (set to undefined), also remove it from highlights
   */
  const handleUpdateSoundConfig = useCallback((index: number, field: keyof SoundGenerationConfig, value: any) => {
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

      // Load into AudioOrchestrator (handles all IR processing)
      await audioOrchestrator.loadImpulseResponse(file);

      // Select the IR to activate it (triggers mode switch)
      await audioOrchestrator.selectImpulseResponse();

      // Update selected IR ID and store full metadata for reload
      setSelectedIRId(irMetadata.id);
      setSelectedIRMetadata(irMetadata);
    } catch (error) {
      console.error('[Auralization Page] Error loading IR from library:', error);
      throw error;
    }
  }, [audioOrchestrator]);

  /**
   * Handle IR imported from Choras simulation
   * Triggers a refresh of the IR library list
   */
  const handleIRImported = useCallback(() => {
    // Increment trigger to force ImpulseResponseUpload to reload its list
    setIrRefreshTrigger(prev => prev + 1);
    console.log('[Page] IR imported from Choras simulation, triggering IR library refresh');
  }, []);

  /**
   * Clear/deselect the current IR (disable auralization)
   */
  const handleClearIR = useCallback(() => {
    audioOrchestrator.clearImpulseResponse();
    setSelectedIRId(null);
    setSelectedIRMetadata(null);
  }, [audioOrchestrator]);

  /**
   * Toggle IR normalization
   */
  const handleToggleNormalize = useCallback((enabled: boolean) => {
    audioNormalization.toggleNormalize(enabled);
  }, [audioNormalization]);

  const handleResetAdvancedSettings = useCallback(() => {
    soundGen.handleResetToDefaults();
    audioNormalization.reset();
  }, [soundGen.handleResetToDefaults, audioNormalization.reset]);

  // Handler: Material assignment selection (NEW)
  const handleSelectGeometry = useCallback((selection: SelectedGeometry | null) => {
    setSelectedGeometry(selection);
  }, []);

  // Handler: Face selected in 3D scene (NEW)
  const handleFaceSelected = useCallback((faceIndex: number, entityIndex: number) => {
    if (faceIndex === -1) {
      // Deselected
      handleSelectGeometry(null);
    } else {
      // Face selected - find the layer if applicable
      const entity = fileUpload.modelEntities.find(e => e.index === entityIndex);
      const layerId = entity?.layer || undefined;

      const selection: SelectedGeometry = {
        type: 'face',
        faceIndex,
        entityIndex,
        layerId
      };
      handleSelectGeometry(selection);
    }
  }, [fileUpload.modelEntities, handleSelectGeometry]);

  // Handler: Material assignment (NEW)
  const [materialAssignments, setMaterialAssignments] = useState<Map<string, { selection: SelectedGeometry, material: AcousticMaterial | null }>>(new Map());
  
  const handleAssignMaterial = useCallback((selection: SelectedGeometry, material: AcousticMaterial | null) => {
    console.log('[Page] Material assigned:', { selection, material });
    
    // Store assignment with a unique key
    const key = `${selection.type}-${selection.layerId ?? ''}-${selection.entityIndex ?? ''}-${selection.faceIndex ?? ''}`;
    setMaterialAssignments(prev => {
      const newMap = new Map(prev);
      newMap.set(key, { selection, material });
      return newMap;
    });
  }, []);

  // Handler: Audio Rendering Mode Change (unified handler for all 3 modes)
  const handleAudioRenderingModeChange = useCallback(async (mode: AudioRenderingMode) => {
    // Stop playback before switching modes to ensure clean state
    if (audioControls.isAnyPlaying()) {
      audioControls.stopAll();
    }

    setAudioRenderingMode(mode);
    console.log('[Page] Audio rendering mode changed to:', mode);

    // When switching away from 'precise' mode, clear the loaded IR (but keep metadata for reload)
    if (mode !== 'precise' && audioOrchestrator.status?.isIRActive) {
      audioOrchestrator.clearImpulseResponse();
      // NOTE: We keep selectedIRId and selectedIRMetadata for reload when returning to precise mode
    }

    // Update AudioOrchestrator's no-IR preference (only for non-IR modes)
    if (mode === 'anechoic' || mode === 'resonance') {
      audioOrchestrator.setNoIRPreference(mode);
    }

    // When switching TO 'precise' mode with a previously selected IR, reload it
    if (mode === 'precise' && selectedIRMetadata && !audioOrchestrator.status?.isIRActive) {
      try {
        console.log('[Page] Reloading previously selected IR:', selectedIRMetadata.name);
        await handleSelectIRFromLibrary(selectedIRMetadata);
      } catch (error) {
        console.error('[Page] Failed to reload IR:', error);
      }
    }
  }, [audioOrchestrator, audioControls, selectedIRMetadata, handleSelectIRFromLibrary]);

  // Handler: Update Output Decoder (Removed - binaural is default)
  const handleUpdateOutputDecoder = useCallback((decoder: 'binaural' | 'stereo') => {
    // REMOVED - Output decoder toggle removed from UI
    // Binaural (HRTF) is now the default and only option
    console.log('[Page] Output decoder changed to:', decoder, '(binaural-only now)');
  }, []);

  // Create compatibility config objects for components that still expect them
  const irState = audioOrchestrator.getIRState();
  const auralizationConfig = {
    enabled: audioOrchestrator.status?.isIRActive || false,
    impulseResponseUrl: null,
    impulseResponseBuffer: irState.buffer || null,
    impulseResponseFilename: irState.filename || null,
    normalize: audioNormalization.normalize
  };

  const resonanceAudioConfig = {
    enabled: audioOrchestrator.status?.currentMode === 'no_ir_resonance',
    ambisonicOrder: audioOrchestrator.status?.ambisonicOrder || 1,
    roomDimensions: roomMaterials.roomDimensions,
    roomMaterials: roomMaterials.roomMaterials
  };

  // Handler: Room materials update
  const handleUpdateRoomMaterials = useCallback((materials: any) => {
    roomMaterials.updateRoomMaterials(materials);
  }, [roomMaterials]);

  // Handler: Receiver Mode Change (from ThreeScene)
  const handleReceiverModeChange = useCallback((isActive: boolean, receiverId: string | null) => {
    const hasReceivers = receivers.receivers.length > 0;
    console.log('[Page] Receiver mode changed:', { isActive, receiverId, hasReceivers });
    audioOrchestrator.setReceiverMode(isActive, receiverId || undefined, hasReceivers);
  }, [audioOrchestrator, receivers.receivers.length]);

  // Sync receiver count with AudioOrchestrator when receivers are added/removed
  useEffect(() => {
    if (!audioOrchestrator.isInitialized || !audioOrchestrator.status) return;

    const hasReceivers = receivers.receivers.length > 0;
    const isReceiverModeActive = audioOrchestrator.status.isReceiverModeActive;

    // Update orchestrator about receiver existence (preserving current active state)
    // This ensures warning messages update when receivers are created/deleted
    audioOrchestrator.setReceiverMode(isReceiverModeActive, undefined, hasReceivers);
  }, [receivers.receivers.length, audioOrchestrator.isInitialized]);

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
        modelFile={fileUpload.modelFile}
        audioFile={fileUpload.audioFile}
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
        onUploadModel={fileUpload.handleUploadModel}
        onLoadSampleIfc={fileUpload.handleLoadSampleIfc}
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
        selectedDiverseEntities={textGen.selectedDiverseEntities}
        isAnalyzingEntities={textGen.isAnalyzingEntities}
        setAiPrompt={textGen.setAiPrompt}
        setNumSounds={textGen.setNumSounds}
        onGenerateText={textGen.handleGenerateText}
        onAnalyzeModel={textGen.handleAnalyzeModel}
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
        individualSoundStates={audioControls.individualSoundStates}
        onToggleSound={audioControls.toggleSound}
        onVolumeChange={audioControls.handleVolumeChange}
        onIntervalChange={audioControls.handleIntervalChange}
        onMute={audioControls.handleMute}
        onSolo={audioControls.handleSolo}
        onVariantChange={audioControls.handleVariantChange}
        mutedSounds={audioControls.mutedSounds}
        soloedSound={audioControls.soloedSound}
        onResetSound={handleResetSound}
        onSelectSoundCard={handleSelectSoundCard}
        selectedCardIndex={selectedCardIndex}
        soundVolumes={audioControls.soundVolumes}
        soundIntervals={audioControls.soundIntervals}

        // Soundcard preview playback props
        previewingSoundId={audioControls.previewingSoundId}
        onPreviewPlayPause={audioControls.handlePreviewPlayPause}
        onPreviewStop={audioControls.handlePreviewStop}

        // AI tab props
        activeAiTab={textGen.activeAiTab}
        setActiveAiTab={textGen.setActiveAiTab}

        // Soundscape data
        soundscapeData={soundGen.soundscapeData}

        // IR Library props
        onSelectIRFromLibrary={handleSelectIRFromLibrary}
        onClearIR={handleClearIR}
        selectedIRId={selectedIRId}
        auralizationConfig={auralizationConfig}

        // Receiver props
        receivers={receivers.receivers}
        isPlacingReceiver={receivers.isPlacingReceiver}
        onStartPlacingReceiver={receivers.startPlacingReceiver}
        onDeleteReceiver={receivers.deleteReceiver}
        onUpdateReceiverName={receivers.updateReceiverName}

        // ShoeBox Acoustics props
        resonanceAudioConfig={resonanceAudioConfig}
        onToggleResonanceAudio={() => {}} // No-op: mode switching handled by audioRenderingMode
        onUpdateRoomMaterials={handleUpdateRoomMaterials}
        hasGeometry={fileUpload.geometryData !== null}
        showBoundingBox={showBoundingBox}
        onToggleBoundingBox={setShowBoundingBox}
        onRefreshBoundingBox={handleRefreshBoundingBox}

        // Audio Orchestrator props (TODO: Phase 1-6)
        audioRenderingMode={audioRenderingMode}
        onAudioRenderingModeChange={handleAudioRenderingModeChange}

        // Material assignment props (NEW)
        modelType={modelType}
        geometryData={fileUpload.geometryData}
        selectedGeometry={selectedGeometry}
        onSelectGeometry={handleSelectGeometry}
        onAssignMaterial={handleAssignMaterial}
        onIRImported={handleIRImported}
        irRefreshTrigger={irRefreshTrigger}
      />

      <main className="flex-1 overflow-hidden relative">
        {/* Audio Status Display - Top Right Overlay
        <AudioStatusDisplay
          status={audioOrchestrator.status}
          warnings={audioOrchestrator.getWarnings()}
          onClearWarnings={audioOrchestrator.clearWarnings}
        /> */}


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
          onSelectSoundCard={handleSelectSoundCard}
          selectedCardIndex={selectedCardIndex}
          onPlayAll={audioControls.playAll}
          onPauseAll={audioControls.pauseAll}
          onStopAll={audioControls.stopAll}
          isAnyPlaying={audioControls.isAnyPlaying()}
          scaleForSounds={fileUpload.scaleForSounds}
          modelEntities={fileUpload.modelEntities}
          selectedDiverseEntities={textGen.selectedDiverseEntities}
          auralizationConfig={auralizationConfig}
          resonanceAudioConfig={resonanceAudioConfig}
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
          onToggleDiverseSelection={handleToggleDiverseSelection}
          onDetachSound={handleDetachSound}
          modeVisualizationState={modalImpact.visualizationState}
          onSetModeVisualization={modalImpact.setModeVisualization}
          onSelectMode={modalImpact.selectMode}
          onReceiverModeChange={handleReceiverModeChange}
          audioRenderingMode={audioRenderingMode}
          audioOrchestrator={audioOrchestrator.orchestrator}
          audioContext={audioOrchestrator.audioContext}
          selectedIRId={selectedIRId}
          globalDuration={soundGen.globalDuration}
          globalSteps={soundGen.globalSteps}
          globalNegativePrompt={soundGen.globalNegativePrompt}
          applyDenoising={soundGen.applyDenoising}
          normalizeImpulseResponses={auralizationConfig.normalize}
          audioModel={soundGen.audioModel}
          onGlobalDurationChange={soundGen.handleGlobalDurationChange}
          onGlobalStepsChange={soundGen.handleGlobalStepsChange}
          onGlobalNegativePromptChange={soundGen.setGlobalNegativePrompt}
          onApplyDenoisingChange={soundGen.setApplyDenoising}
          onNormalizeImpulseResponsesChange={handleToggleNormalize}
          onAudioModelChange={soundGen.setAudioModel}
          onResetAdvancedSettings={handleResetAdvancedSettings}
          selectedGeometry={selectedGeometry}
          onFaceSelected={handleFaceSelected}
          materialAssignments={materialAssignments}
          className="w-full h-full"
        />
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <ErrorProvider>
      <ErrorToast />
      <HomeContent />
    </ErrorProvider>
  );
}
