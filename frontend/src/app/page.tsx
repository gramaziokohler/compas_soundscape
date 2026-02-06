"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { SpeckleScene } from "@/components/scene/SpeckleScene";
import { Sidebar } from "@/components/layout/Sidebar";
import { RightSidebar } from "@/components/layout/RightSidebar";
import { IRStatusNotice } from "@/components/audio/IRStatusNotice";
import { ErrorProvider } from "@/contexts/ErrorContext";
import { ErrorToast } from "@/components/ui/ErrorToast";
import { SpeckleViewerProvider, useSpeckleViewerContext } from "@/contexts/SpeckleViewerContext";
import { SpeckleSelectionModeProvider, useSpeckleSelectionMode } from "@/contexts/SpeckleSelectionModeContext";
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
import { useAcousticsSimulation } from "@/hooks/useAcousticsSimulation";
import { useAnalysis } from "@/hooks/useAnalysis";
import { apiService } from "@/services/api";
import { API_BASE_URL } from "@/lib/constants";
import type { LoadTab, SoundGenerationConfig } from "@/types";
import type { SelectedGeometry, AcousticMaterial } from "@/types/materials";
import { AudioStatusDisplay } from "@/components/audio/AudioStatusDisplay";
import type { AudioRenderingMode } from "@/components/audio/AudioRenderingModeSelector";

function HomeContent() {
  const fileUpload = useFileUpload();
  const textGen = useTextGeneration(fileUpload.modelEntities, fileUpload.useModelAsContext);

  // Speckle-computed bounds state (updated by SpeckleScene callback when viewer computes bounds)
  const [speckleBounds, setSpeckleBounds] = useState<{min: [number, number, number], max: [number, number, number]} | null>(null);

  const soundGen = useSoundGeneration(speckleBounds);
  const audioControls = useAudioControls(soundGen.generatedSounds);
  const analysis = useAnalysis();
  
  // Get Speckle viewer context
  const { viewerRef, setModelFileName } = useSpeckleViewerContext();
  
  // Get Speckle selection mode context
  const { linkObjectToSound, unlinkObjectFromSound } = useSpeckleSelectionMode();

  const sed = useSED();

  // MAIN AUDIO SYSTEM: Handles all 6 audio modes (Flat Anechoic, ShoeBox Acoustics, Spatial Anechoic, Mono IR, Stereo IR, Ambisonic IR)
  const audioOrchestrator = useAudioOrchestrator();
  
  // Store orchestrator in ref for stable callback access
  const orchestratorRef = useRef(audioOrchestrator.orchestrator);
  useEffect(() => {
    orchestratorRef.current = audioOrchestrator.orchestrator;
  }, [audioOrchestrator.orchestrator]);

  // Audio feature hooks (modular, integrate with orchestrator)
  const audioNormalization = useAudioNormalization(audioOrchestrator.orchestrator);
  const roomMaterials = useRoomMaterials(audioOrchestrator.orchestrator);
  
  // Receiver selection callback - updates AudioOrchestrator with new receiver
  // Use ref to access latest orchestrator without recreating callback
  const handleReceiverSelected = useCallback(async (receiverId: string) => {
    console.log('[Page] 🎯 Receiver selected:', receiverId);
    console.log('[Page] Orchestrator exists?', !!orchestratorRef.current);
    
    if (orchestratorRef.current) {
      console.log('[Page] ⚡ Calling updateActiveReceiver...');
      try {
        await orchestratorRef.current.updateActiveReceiver(receiverId);
        console.log('[Page] ✅ Receiver audio updated:', receiverId);
      } catch (error) {
        console.error('[Page] ❌ Failed to update active receiver:', error);
      }
    } else {
      console.warn('[Page] ❌ No orchestrator available');
    }
  }, []); // Empty deps - uses ref for orchestrator
  
  const receivers = useReceivers({ onReceiverSelected: handleReceiverSelected });
  const modalImpact = useModalImpact();
  const acousticsSimulation = useAcousticsSimulation();
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
  
  // Speckle viewer state
  const [useSpeckleViewer, setUseSpeckleViewer] = useState(true);
  const [speckleModelUrl, setSpeckleModelUrl] = useState<string | undefined>(undefined);
  const speckleViewerRef = useRef<import('@/components/scene/SpeckleViewer_Deprecated').SpeckleViewerHandle>(null);

  // Global model state (for RightSidebar uploads - bypasses useAnalysis)
  const [globalModelFile, setGlobalModelFile] = useState<File | null>(null);
  const [globalSpeckleData, setGlobalSpeckleData] = useState<any>(null);
  const [isUploadingGlobalModel, setIsUploadingGlobalModel] = useState(false);

  // Sidebar expanded states (for adjusting SpeckleScene control button and timeline positions)
  const [isLeftSidebarExpanded, setIsLeftSidebarExpanded] = useState(true);
  const [isRightSidebarExpanded, setIsRightSidebarExpanded] = useState(true);

  // Callback when Speckle viewer is loaded
  const handleSpeckleViewerLoaded = useCallback((viewer: import('@speckle/viewer').Viewer) => {
    console.log('Speckle viewer loaded:', viewer);
  }, []);
  
  // Scene visualization state
  const [showAxesHelper, setShowAxesHelper] = useState(false);
  
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

  // Set source-receiver IR mapping when simulation completes (PyroomAcoustics)
  useEffect(() => {
    if (!audioOrchestrator.orchestrator) return;

    // Check if active simulation is Pyroomacoustics and has source-receiver mapping
    if (acousticsSimulation.activeSimulationIndex !== null) {
      const activeConfig = acousticsSimulation.simulationConfigs[acousticsSimulation.activeSimulationIndex];
      
      if (activeConfig && activeConfig.type === 'pyroomacoustics') {
        const pyroomConfig = activeConfig as any;
        
        // If simulation has source-receiver IR mapping, pass it to AudioOrchestrator
        if (pyroomConfig.sourceReceiverIRMapping) {
          console.log('[Page] Setting source-receiver IR mapping from simulation', {
            simulationId: activeConfig.id,
            hasMapping: !!pyroomConfig.sourceReceiverIRMapping,
            sourceCount: Object.keys(pyroomConfig.sourceReceiverIRMapping).length
          });
          
          // Get first receiver ID as initial selection (if receivers exist)
          const initialReceiverId = receivers.receivers.length > 0 ? receivers.receivers[0].id : undefined;
          
          audioOrchestrator.orchestrator.setSourceReceiverIRMapping(
            pyroomConfig.sourceReceiverIRMapping,
            'pyroomacoustics',
            initialReceiverId
          ).then(() => {
            console.log('[Page] ✅ Source-receiver IR mapping applied successfully');
          }).catch(error => {
            console.error('[Page] ❌ Failed to set source-receiver IR mapping:', error);
          });
        }
      }
    }
  }, [
    audioOrchestrator.orchestrator,
    acousticsSimulation.activeSimulationIndex,
    acousticsSimulation.simulationConfigs,
    receivers.receivers
  ]);

  // Stop timeline when switching between simulation tabs
  const prevActiveIndexRef = useRef<number | null>(acousticsSimulation.activeSimulationIndex);
  
  useEffect(() => {
    const prevIndex = prevActiveIndexRef.current;
    const currentIndex = acousticsSimulation.activeSimulationIndex;
    
    // Only stop if we're actually switching between simulations (not on initial mount)
    if (prevIndex !== null && prevIndex !== currentIndex) {
      console.log(`[Page] Switching simulation tabs: ${prevIndex} → ${currentIndex}, stopping timeline`);
      audioControls.stopAll();
    }
    
    // Update ref for next comparison
    prevActiveIndexRef.current = currentIndex;
  }, [acousticsSimulation.activeSimulationIndex, audioControls.stopAll]);
  
  // Entity linking state
  const [isLinkingEntity, setIsLinkingEntity] = useState(false);
  const [linkingConfigIndex, setLinkingConfigIndex] = useState<number | null>(null);
  const [selectedCardIndex, setSelectedCardIndex] = useState<number | null>(null);

  // Material assignment state (NEW)
  const [selectedGeometry, setSelectedGeometry] = useState<SelectedGeometry | null>(null);
  const [hoveredGeometry, setHoveredGeometry] = useState<SelectedGeometry | null>(null);
  const [modelType, setModelType] = useState<'3dm' | 'obj' | 'ifc' | null>(null);

  // Go to receiver state (triggers first-person view at specific receiver)
  const [goToReceiverId, setGoToReceiverId] = useState<string | null>(null);

  // Detect model type from file extension and set model filename in context
  useEffect(() => {
    const modelFile = fileUpload.modelFile || globalModelFile;
    if (modelFile) {
      const fileName = modelFile.name.toLowerCase();
      console.log('[page.tsx] Setting model filename in context:', modelFile.name);
      if (fileName.endsWith('.3dm')) {
        setModelType('3dm');
      } else if (fileName.endsWith('.obj')) {
        setModelType('obj');
      } else if (fileName.endsWith('.ifc')) {
        setModelType('ifc');
      } else {
        setModelType(null);
      }
      // Update model filename in Speckle viewer context
      setModelFileName(modelFile.name);
    } else {
      console.log('[page.tsx] Clearing model filename from context');
      setModelType(null);
      setModelFileName(null);
    }
  }, [fileUpload.modelFile, globalModelFile, setModelFileName]);

  // Clear analyzed entities when model changes
  useEffect(() => {
    // Clear the analysis when new model is loaded or model is unloaded
    textGen.handleClearAnalysis();
  }, [fileUpload.modelFile, fileUpload.modelEntities.length]);

  // ============================================================================
  // Effect - Register Entity-Sound Links When Sounds Are Generated
  // This ensures filtering colors are applied for entity-linked sounds from Analysis
  // ============================================================================
  useEffect(() => {
    if (!soundGen.generatedSounds || soundGen.generatedSounds.length === 0) {
      return;
    }

    // For each generated sound, check if its config has entity data
    soundGen.generatedSounds.forEach((sound: any) => {
      const promptIndex = sound.prompt_index;
      if (promptIndex === undefined) return;

      const config = soundGen.soundConfigs[promptIndex];
      if (!config?.entity) return;

      // Get the object ID from the entity (Speckle object ID)
      const objectId = config.entity.nodeId || config.entity.id;
      if (!objectId) return;

      // Register the entity-sound link in SpeckleSelectionModeContext
      // This will trigger applyFilterColors to color the entity green
      linkObjectToSound(objectId, promptIndex);
    });
  }, [soundGen.generatedSounds, soundGen.soundConfigs, linkObjectToSound]);

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

  // Handler: Send analysis prompts to sound generation
  const handleSendAnalysisToGeneration = useCallback(() => {
    analysis.handleSendToSoundGeneration((prompts) => {
      // Convert text prompts to sound configs
      const newConfigs = prompts.map(p => ({
        prompt: p.text,
        duration: p.metadata?.duration_seconds ?? 10, // Use duration from metadata
        guidance_scale: 4.5,
        negative_prompt: '',
        seed_copies: 1,
        steps: 100,
        spl_db: p.metadata?.spl_db ?? 60, // Default SPL if not provided
        interval_seconds: p.metadata?.interval_seconds ?? 5, // Default interval if not provided
        display_name: p.text.length > 50 ? p.text.substring(0, 47) + '...' : p.text,
        entity: p.entity || undefined // Preserve entity association for 3D model sounds
      }));

      console.log('[Analysis→SoundGen] Converted configs with metadata:', 
        newConfigs.map(c => ({ prompt: c.prompt.substring(0, 30), duration: c.duration, spl_db: c.spl_db, interval_seconds: c.interval_seconds, hasEntity: !!c.entity })));

      // Add to sound generation
      soundGen.setSoundConfigsFromPrompts(newConfigs);
      
      // Switch to sound generation tab
      textGen.setActiveAiTab('sound');

      console.log(`Loaded ${newConfigs.length} prompts from analysis to sound generation`);
    });
  }, [analysis, soundGen, textGen]);

  // Handler: Add analysis config with global model inheritance
  const handleAddAnalysisConfig = useCallback((type: import('@/types/card').CardType) => {
    // For 3D model configs, pass globalSpeckleData so new card inherits the loaded model
    if (type === '3d-model' && globalSpeckleData) {
      analysis.handleAddConfig(type, globalSpeckleData);
    } else {
      analysis.handleAddConfig(type);
    }
  }, [analysis, globalSpeckleData]);

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

  // Handler: Upload model file from right sidebar (direct Speckle upload, bypasses useAnalysis)
  const handleRightSidebarModelUpload = useCallback(async (file: File) => {
    console.log('[page.tsx] Model file dropped in right sidebar:', file.name);

    if (isUploadingGlobalModel) {
      console.log('[page.tsx] Global upload already in progress');
      return;
    }

    setIsUploadingGlobalModel(true);
    setGlobalModelFile(file);

    try {
      // Upload directly to backend for Speckle conversion
      const uploadResponse = await apiService.uploadFile(file);

      // Extract speckle data from response
      const speckleData = 'speckle' in uploadResponse ? uploadResponse.speckle : undefined;

      if (speckleData) {
        console.log('[page.tsx] Model uploaded to Speckle:', speckleData.url);
        setGlobalSpeckleData(speckleData);
        setSpeckleModelUrl(speckleData.url);
      } else {
        console.warn('[page.tsx] No Speckle data in upload response');
      }
    } catch (error) {
      console.error('[page.tsx] Failed to upload model:', error);
      setGlobalModelFile(null);
    } finally {
      setIsUploadingGlobalModel(false);
    }
  }, [isUploadingGlobalModel]);

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

  // Note: Auto-upload is handled by the analysis.handleModelFileUpload in the effect below
  // This prevents duplicate uploads

  // Auto-upload files when added to analysis configs
  useEffect(() => {
    analysis.analysisConfigs.forEach((config, index) => {
      if (config.type === '3d-model' && config.modelFile && !config.speckleData) {
        // Only upload if not already uploaded (check speckleData instead of modelEntities)
        // Get worldTree from viewer for Speckle objects
        const worldTree = viewerRef?.current?.getWorldTree();
        
        console.log('[page.tsx] Auto-uploading model file for config', index);
        // Upload 3D model file with worldTree for Speckle object extraction
        analysis.handleModelFileUpload(index, config.modelFile, worldTree);
      } else if (config.type === 'audio' && config.audioFile && !config.audioBuffer) {
        // Load audio file and buffer
        analysis.handleAudioFileUpload(index, config.audioFile);
      }
    });
  }, [analysis.analysisConfigs, viewerRef]);

  // Populate entities from worldTree when it becomes available
  // Poll for worldTree readiness
  const [worldTreeReady, setWorldTreeReady] = useState(false);
  
  useEffect(() => {
    if (!viewerRef?.current) return;

    const checkInterval = setInterval(() => {
      const worldTree = viewerRef.current?.getWorldTree();
      // Use type casting to access internal tree structure (private in TypeScript but accessible at runtime)
      const worldTreeAny = worldTree as any;
      const children = worldTreeAny?.tree?._root?.children ||
                      worldTreeAny?._root?.children ||
                      worldTreeAny?.root?.children ||
                      worldTreeAny?.children;
      
      if (children && children.length > 0) {
        console.log('[page.tsx] ✅ WorldTree ready with', children.length, 'root nodes');
        setWorldTreeReady(true);
        clearInterval(checkInterval);
      }
    }, 500);

    return () => clearInterval(checkInterval);
  }, [viewerRef?.current]);
  
  useEffect(() => {
    if (!viewerRef?.current || !worldTreeReady) {
      console.log('[page.tsx] Waiting for worldTree...', { hasViewer: !!viewerRef?.current, worldTreeReady });
      return;
    }

    const worldTree = viewerRef.current.getWorldTree();
    if (!worldTree) {
      console.log('[page.tsx] WorldTree not yet available');
      return;
    }

    console.log('[page.tsx] WorldTree available, checking configs...');
    
    // Check analysis configs for entity population
    analysis.analysisConfigs.forEach((config, index) => {
      if (config.type === '3d-model' && config.speckleData && config.modelEntities.length === 0) {
        console.log('[page.tsx] WorldTree available, populating entities for config', index);
        analysis.handleUpdateEntitiesFromWorldTree(index, worldTree);
      } else if (config.type === '3d-model') {
        console.log(`[page.tsx] Config ${index} status:`, {
          hasSpeckleData: !!config.speckleData,
          entitiesCount: config.modelEntities.length
        });
      }
    });
  }, [analysis.analysisConfigs, worldTreeReady, analysis.handleUpdateEntitiesFromWorldTree]);

  // Sync analysis model to main fileUpload state (for ThreeScene)
  useEffect(() => {
    const modelConfigs = analysis.analysisConfigs.filter(c => c.type === '3d-model');
    if (modelConfigs.length > 0) {
      const latestConfig = modelConfigs[modelConfigs.length - 1] as import('@/types/analysis').ModelAnalysisConfig;
      
      // Only sync if we have geometry data and it's different from current
      if (latestConfig.geometryData && latestConfig.geometryData !== fileUpload.geometryData) {
        fileUpload.setGeometryData(latestConfig.geometryData);
      }
      
      // Sync model file if different
      if (latestConfig.modelFile && latestConfig.modelFile !== fileUpload.modelFile) {
        fileUpload.setModelFile(latestConfig.modelFile);
      }
      
      // Sync entities if available and different
      if (latestConfig.modelEntities.length > 0 && 
          JSON.stringify(latestConfig.modelEntities) !== JSON.stringify(fileUpload.modelEntities)) {
        fileUpload.setModelEntities(latestConfig.modelEntities);
      }
      
      // Sync speckle data for Speckle viewer
      if (latestConfig.speckleData && latestConfig.speckleData.url !== speckleModelUrl) {
        console.log('[page.tsx] Setting Speckle model URL:', latestConfig.speckleData.url);
        setSpeckleModelUrl(latestConfig.speckleData.url);
      }
      
      // Sync selectedDiverseEntities to textGen for ThreeScene highlighting
      if (latestConfig.selectedDiverseEntities.length > 0 &&
          JSON.stringify(latestConfig.selectedDiverseEntities) !== JSON.stringify(textGen.selectedDiverseEntities)) {
        textGen.setSelectedDiverseEntities(latestConfig.selectedDiverseEntities);
      }
    }
  }, [analysis.analysisConfigs, fileUpload, textGen, speckleModelUrl]);

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

  /**
   * Helper: Get current selectedDiverseEntities from analysis config
   */
  const getSelectedDiverseEntities = useCallback(() => {
    const modelConfig = analysis.analysisConfigs.find(c => c.type === '3d-model');
    return modelConfig?.type === '3d-model' ? modelConfig.selectedDiverseEntities : [];
  }, [analysis.analysisConfigs]);

  /**
   * Helper: Update selectedDiverseEntities in analysis config
   */
  const updateSelectedDiverseEntities = useCallback((entities: any[]) => {
    const modelConfigIndex = analysis.analysisConfigs.findIndex(c => c.type === '3d-model');
    if (modelConfigIndex !== -1) {
      analysis.handleUpdateConfig(modelConfigIndex, { selectedDiverseEntities: entities });
    }
  }, [analysis]);

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
          
          // Unlink from Speckle context if it's a Speckle object
          const objectId = previousEntity.nodeId || previousEntity.id;
          if (objectId) {
            unlinkObjectFromSound(objectId);
          }

          // Remove the previous entity from highlights
          const selectedEntities = getSelectedDiverseEntities();
          const updatedEntities = selectedEntities.filter(
            e => e.index !== previousEntity.index
          );
          updateSelectedDiverseEntities(updatedEntities);
        }

        // Exit linking mode (whether we unlinked or not)
        setIsLinkingEntity(false);
        setLinkingConfigIndex(null);
        return;
      }

      // Entity is not null - link the new entity
      // This will destroy sound sphere (if exists) and move overlay to entity
      soundGen.handleAttachSoundToEntity(linkingConfigIndex, entity);
      
      // Link in Speckle context if it's a Speckle object
      const objectId = entity.nodeId || entity.id;
      if (objectId) {
        linkObjectToSound(objectId, linkingConfigIndex);
      }

      // Update diverse selection to highlight the new entity
      let updatedEntities = [...getSelectedDiverseEntities()];

      // Remove the previous entity from highlights if it exists
      if (previousEntity) {
        updatedEntities = updatedEntities.filter(e => e.index !== previousEntity.index);
        
        // Unlink previous Speckle object
        const prevObjectId = previousEntity.nodeId || previousEntity.id;
        if (prevObjectId) {
          unlinkObjectFromSound(prevObjectId);
        }
      }

      // Add the new entity to highlights if not already present
      if (!updatedEntities.find(e => e.index === entity.index)) {
        updatedEntities.push(entity);
      }

      updateSelectedDiverseEntities(updatedEntities);

      setIsLinkingEntity(false);
      setLinkingConfigIndex(null);
    }
  }, [linkingConfigIndex, soundGen, getSelectedDiverseEntities, updateSelectedDiverseEntities, linkObjectToSound, unlinkObjectFromSound]);

  /**
   * Toggle entity in diverse selection (for LLM prompts)
   * Used from entity overlay link button: grey <-> pink
   * Works with both Three.js entities (index) and Speckle objects (nodeId/id)
   */
  const handleToggleDiverseSelection = useCallback((entity: any) => {
    const selectedEntities = getSelectedDiverseEntities();
    
    // Check if entity is already selected
    // Support both Three.js entities (using index) and Speckle objects (using nodeId/id)
    const isCurrentlySelected = selectedEntities.some(e => {
      // For Speckle objects, match by nodeId or id
      if (entity.nodeId || entity.id) {
        const entityId = entity.nodeId || entity.id;
        return (e.nodeId === entityId) || (e.id === entityId);
      }
      // For Three.js entities, match by index
      return e.index === entity.index;
    });

    if (isCurrentlySelected) {
      // Remove from selection
      const updatedEntities = selectedEntities.filter(e => {
        // For Speckle objects
        if (entity.nodeId || entity.id) {
          const entityId = entity.nodeId || entity.id;
          return !((e.nodeId === entityId) || (e.id === entityId));
        }
        // For Three.js entities
        return e.index !== entity.index;
      });
      updateSelectedDiverseEntities(updatedEntities);
    } else {
      // Add to selection
      updateSelectedDiverseEntities([...selectedEntities, entity]);
    }
  }, [getSelectedDiverseEntities, updateSelectedDiverseEntities]);

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
    const selectedEntities = getSelectedDiverseEntities();
    if (!selectedEntities.some(e => e.index === entity.index)) {
      updateSelectedDiverseEntities([...selectedEntities, entity]);
    }
  }, [soundGen, getSelectedDiverseEntities, updateSelectedDiverseEntities]);

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
        const selectedEntities = getSelectedDiverseEntities();
        const updatedEntities = selectedEntities.filter(
          e => e.index !== previousEntity.index
        );
        updateSelectedDiverseEntities(updatedEntities);
      }
    }

    // Call the original handler
    soundGen.handleUpdateConfig(index, field, value);
  }, [soundGen, getSelectedDiverseEntities, updateSelectedDiverseEntities]);

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
    setShowAxesHelper(false);
  }, [soundGen.handleResetToDefaults, audioNormalization.reset]);

  // Handler: Material assignment selection (NEW)
  const handleSelectGeometry = useCallback((selection: SelectedGeometry | null) => {
    setSelectedGeometry(selection);
  }, []);

  // Handler: Geometry hover (NEW - for hover highlighting)
  const handleHoverGeometry = useCallback((selection: SelectedGeometry | null) => {
    setHoveredGeometry(selection);
  }, []);

  // Handler: Face selected in 3D scene (NEW)
  const handleFaceSelected = useCallback((faceIndex: number, entityIndex: number) => {
    console.log('[Page] handleFaceSelected called:', { faceIndex, entityIndex });
    if (faceIndex === -1) {
      // Deselected
      console.log('[Page] Deselecting face');
      handleSelectGeometry(null);
    } else if (faceIndex === -2) {
      // Special signal: select entity instead of face (for large entities)
      const entity = fileUpload.modelEntities.find(e => e.index === entityIndex);
      const layerId = entity?.layer || 'Default';

      const selection: SelectedGeometry = {
        type: 'entity',
        entityIndex,
        layerId
      };
      console.log('[Page] Setting selectedGeometry (entity):', selection);
      handleSelectGeometry(selection);
    } else {
      // Face selected - find the layer if applicable
      const entity = fileUpload.modelEntities.find(e => e.index === entityIndex);
      // Use 'Default' for entities without a layer (matches MaterialAssignmentUI grouping)
      const layerId = entity?.layer || 'Default';

      const selection: SelectedGeometry = {
        type: 'face',
        faceIndex,
        entityIndex,
        layerId
      };
      console.log('[Page] Setting selectedGeometry:', selection);
      handleSelectGeometry(selection);
    }
  }, [fileUpload.modelEntities, handleSelectGeometry]);

  // Handler: Material assignment (NEW)
  const [materialAssignments, setMaterialAssignments] = useState<Map<string, { selection: SelectedGeometry, material: AcousticMaterial | null }>>(new Map());

  const handleAssignMaterial = useCallback((selection: SelectedGeometry, material: AcousticMaterial | null) => {
    console.log('[Page] Material assigned:', { selection, material });

    // Store assignment with a unique key (legacy - kept for compatibility)
    const key = `${selection.type}-${selection.layerId ?? ''}-${selection.entityIndex ?? ''}-${selection.faceIndex ?? ''}`;
    setMaterialAssignments(prev => {
      const newMap = new Map(prev);
      newMap.set(key, { selection, material });
      return newMap;
    });

    // Update the active simulation's faceToMaterialMap for immediate 3D coloring
    if (acousticsSimulation.activeSimulationIndex !== null) {
      const activeConfig = acousticsSimulation.simulationConfigs[acousticsSimulation.activeSimulationIndex];

      if (activeConfig && (activeConfig as any).faceToMaterialMap) {
        const updatedMap = new Map((activeConfig as any).faceToMaterialMap);

        // Get the geometry data to find all faces affected by this assignment
        const geometryData = fileUpload.geometryData;

        // Strip prefix from material ID (choras_/pyroom_) to match backend format
        const materialId = material ? (
          material.id.startsWith('choras_') ? material.id.substring(7) :
          material.id.startsWith('pyroom_') ? material.id.substring(7) :
          material.id
        ) : null;

        if (selection.type === 'face' && selection.faceIndex !== undefined) {
          // Single face assignment
          if (materialId) {
            updatedMap.set(selection.faceIndex, materialId);
          } else {
            updatedMap.delete(selection.faceIndex);
          }
        } else if (selection.type === 'entity' && selection.entityIndex !== undefined && geometryData?.face_entity_map) {
          // Entity-level assignment: update all faces of this entity
          geometryData.face_entity_map.forEach((entityIndex, faceIndex) => {
            if (entityIndex === selection.entityIndex) {
              if (materialId) {
                updatedMap.set(faceIndex, materialId);
              } else {
                updatedMap.delete(faceIndex);
              }
            }
          });
        } else if (selection.type === 'layer' && selection.layerId && geometryData?.face_entity_map) {
          // Layer-level assignment: update all faces of entities in this layer
          geometryData.face_entity_map.forEach((entityIndex, faceIndex) => {
            const entity = fileUpload.modelEntities.find(e => e.index === entityIndex);
            if (entity && entity.layer === selection.layerId) {
              if (materialId) {
                updatedMap.set(faceIndex, materialId);
              } else {
                updatedMap.delete(faceIndex);
              }
            }
          });
        } else if (selection.type === 'global' && geometryData?.faces) {
          // Global assignment: update all faces
          if (materialId) {
            for (let i = 0; i < geometryData.faces.length; i++) {
              updatedMap.set(i, materialId);
            }
          } else {
            updatedMap.clear();
          }
        }

        // Update the simulation config with the new faceToMaterialMap
        acousticsSimulation.handleUpdateConfig(acousticsSimulation.activeSimulationIndex, {
          faceToMaterialMap: updatedMap
        } as any);

        console.log('[Page] Updated active simulation faceToMaterialMap:', {
          simulationIndex: acousticsSimulation.activeSimulationIndex,
          mapSize: updatedMap.size,
          selection,
          material: material?.name,
          materialId: materialId,
          originalId: material?.id
        });
      }
    }
  }, [acousticsSimulation, fileUpload.geometryData, fileUpload.modelEntities]);

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

  // Handler: Go To Receiver (activates first-person view at receiver position)
  const handleGoToReceiver = useCallback((receiverId: string) => {
    const receiver = receivers.receivers.find(r => r.id === receiverId);
    if (!receiver) {
      console.warn('[Page] handleGoToReceiver: Receiver not found:', receiverId);
      return;
    }

    console.log('[Page] Go to receiver:', { receiverId, position: receiver.position });

    // Set the receiver ID to trigger the camera movement in ThreeScene
    setGoToReceiverId(receiverId);

    // Activate receiver mode for audio routing
    audioOrchestrator.setReceiverMode(true, receiverId, true);
  }, [receivers.receivers, audioOrchestrator]);

  // Reset goToReceiverId after it's been processed (allows re-triggering same receiver)
  useEffect(() => {
    if (goToReceiverId) {
      const timer = setTimeout(() => setGoToReceiverId(null), 100);
      return () => clearTimeout(timer);
    }
  }, [goToReceiverId]);

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
    <div className="relative w-screen h-screen overflow-hidden bg-gray-100 dark:bg-gray-900">
      {/* Main 3D Scene - Fixed at screen center, full size, lowest z-index */}
      <main className="absolute inset-0 z-0">
        {/* Viewer Toggle Button - Top Left */}
        <div className="absolute top-4 left-4 z-50">
          {/* <button
            onClick={() => setUseSpeckleViewer(!useSpeckleViewer)}
            className="bg-gray-800/90 hover:bg-gray-700 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 transition-colors"
            title={useSpeckleViewer ? "Switch to Three.js Viewer" : "Switch to Speckle Viewer"}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="font-medium">
              {useSpeckleViewer ? "Speckle" : "Three.js"}
            </span>
          </button> */}
        </div>

        {/* Toggle between Speckle Scene and Three.js Scene */}
        {useSpeckleViewer ? (
          <SpeckleScene
            speckleData={(() => {
              // Priority: config with speckleData > globalSpeckleData
              const modelConfigs = analysis.analysisConfigs.filter(c => c.type === '3d-model') as import('@/types/analysis').ModelAnalysisConfig[];
              // Find the latest config that actually has speckleData
              const configWithSpeckle = [...modelConfigs].reverse().find(c => c.speckleData !== undefined);
              if (configWithSpeckle?.speckleData) {
                return configWithSpeckle.speckleData;
              }
              // Fall back to globally loaded model
              return globalSpeckleData;
            })()}
            onViewerLoaded={handleSpeckleViewerLoaded}
            // Audio system props
            audioOrchestrator={audioOrchestrator.orchestrator}
            audioContext={audioOrchestrator.audioContext}
            audioRenderingMode={audioRenderingMode}
            selectedIRId={selectedIRId}
            auralizationConfig={auralizationConfig}
            // Soundscape data
            soundscapeData={soundGen.soundscapeData}
            selectedVariants={audioControls.selectedVariants}
            individualSoundStates={audioControls.individualSoundStates}
            soundVolumes={audioControls.soundVolumes}
            soundIntervals={audioControls.soundIntervals}
            mutedSounds={audioControls.mutedSounds}
            soloedSound={audioControls.soloedSound}
            scaleForSounds={fileUpload.scaleForSounds}
            // Receivers
            receivers={receivers.receivers}
            selectedReceiverId={receivers.selectedReceiverId}
            onUpdateReceiverPosition={receivers.updateReceiverPosition}
            onReceiverSelected={receivers.selectReceiver}
            onReceiverModeChange={handleReceiverModeChange}
            goToReceiverId={goToReceiverId}
            // Sound sphere position update (for simulation sync when dragging)
            onUpdateSoundPosition={soundGen.updateSoundPosition}
            // Sound Linking (entity linking from SoundCard to Speckle object)
            entitiesWithLinkedSounds={(() => {
              // Build set of entity indices that have sounds linked
              const linked = new Set<number>();
              soundGen.soundConfigs.forEach((config) => {
                if (config.entity && config.entity.id !== undefined) {
                  // Parse entity index from entity.id if numeric
                  const entityIndex = typeof config.entity.id === 'number'
                    ? config.entity.id
                    : parseInt(config.entity.id, 10);
                  if (!isNaN(entityIndex)) {
                    linked.add(entityIndex);
                  }
                }
              });
              return linked;
            })()}
            onToggleDiverseSelection={handleToggleDiverseSelection}
            // Sound card selection (for expand/highlight logic)
            selectedCardIndex={selectedCardIndex}
            onSelectSoundCard={handleSelectSoundCard}
            // Entity linking (sound-to-Speckle-object linking)
            isLinkingEntity={isLinkingEntity}
            linkingConfigIndex={linkingConfigIndex}
            onEntityLinked={handleEntityLinked}
            // Playback controls
            onPlayAll={audioControls.playAll}
            onPauseAll={audioControls.pauseAll}
            onStopAll={audioControls.stopAll}
            isAnyPlaying={audioControls.isAnyPlaying()}
            // Resonance Audio (ShoeBox Acoustics)
            resonanceAudioConfig={resonanceAudioConfig}
            showBoundingBox={showBoundingBox}
            refreshBoundingBoxTrigger={refreshBoundingBoxTrigger}
            // Callback when Speckle viewer computes model bounds (for sound sphere placement)
            onBoundsComputed={setSpeckleBounds}
            // Sidebar states for control button and timeline positioning
            isLeftSidebarExpanded={isLeftSidebarExpanded}
            isRightSidebarExpanded={isRightSidebarExpanded}
            className="w-full h-full"
          />
        ) : (
          /* ThreeScene is deprecated - SpeckleScene is the default viewer */
          <div className="w-full h-full flex items-center justify-center bg-gray-900 text-gray-400">
            <div className="text-center">
              <p className="text-lg mb-2">Three.js Viewer (Deprecated)</p>
              <p className="text-sm">Please use SpeckleScene viewer instead.</p>
            </div>
          </div>
        )}
      </main>

      {/* Left Sidebar - Overlays on top of scene */}
      <Sidebar
        // File upload props
        modelFile={fileUpload.modelFile}
        speckleData={(() => {
          // Priority: config with speckleData > globalSpeckleData
          const modelConfigs = analysis.analysisConfigs.filter(c => c.type === '3d-model') as import('@/types/analysis').ModelAnalysisConfig[];
          const configWithSpeckle = [...modelConfigs].reverse().find(c => c.speckleData !== undefined);
          if (configWithSpeckle?.speckleData) {
            return configWithSpeckle.speckleData;
          }
          return globalSpeckleData;
        })()}
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
        onSoundTypeChange={soundGen.handleTypeChange}
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
        useSpeckleViewer={useSpeckleViewer}

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
        onAddReceiver={receivers.addReceiver}
        onDeleteReceiver={receivers.deleteReceiver}
        onUpdateReceiverName={receivers.updateReceiverName}
        onGoToReceiver={handleGoToReceiver}
        onAddGridReceiver={receivers.addGridReceiver}

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
        selectedGeometry={selectedGeometry}
        onSelectGeometry={handleSelectGeometry}
        onHoverGeometry={handleHoverGeometry}
        onAssignMaterial={handleAssignMaterial}
        onIRImported={handleIRImported}
        irRefreshTrigger={irRefreshTrigger}

        // Acoustics simulation state (passed down to avoid duplicate hook calls)
        simulationConfigs={acousticsSimulation.simulationConfigs}
        activeSimulationIndex={acousticsSimulation.activeSimulationIndex}
        expandedTabIndex={acousticsSimulation.expandedTabIndex}
        onAddSimulationConfig={acousticsSimulation.handleAddConfig}
        onRemoveSimulationConfig={acousticsSimulation.handleRemoveConfig}
        onUpdateSimulationConfig={acousticsSimulation.handleUpdateConfig}
        onSetActiveSimulation={acousticsSimulation.handleSetActiveSimulation}
        onUpdateSimulationName={acousticsSimulation.handleUpdateSimulationName}
        onToggleExpandSimulation={acousticsSimulation.handleToggleExpand}

        // Analysis props
        analysisConfigs={analysis.analysisConfigs}
        activeAnalysisTab={analysis.activeAnalysisTab}
        isAnalyzing={analysis.isAnalyzing}
        analysisError={analysis.analysisError}
        analysisResult={analysis.analysisResults}
        hasGlobalModelLoaded={globalSpeckleData !== null}
        onAddAnalysisConfig={handleAddAnalysisConfig}
        onRemoveAnalysisConfig={analysis.handleRemoveConfig}
        onUpdateAnalysisConfig={analysis.handleUpdateConfig}
        onSetActiveAnalysisTab={analysis.setActiveAnalysisTab}
        onAnalyze={analysis.handleAnalyze}
        onStop={analysis.handleStopAnalysis}
        onTogglePromptSelection={analysis.handleTogglePromptSelection}
        onSendToSoundGeneration={handleSendAnalysisToGeneration}
        onResetAnalysis={analysis.handleReset}
        
        // Advanced settings props
        normalizeImpulseResponses={auralizationConfig.normalize}
        showAxesHelper={showAxesHelper}
        onNormalizeImpulseResponsesChange={handleToggleNormalize}
        onShowAxesHelperChange={setShowAxesHelper}
        onResetAdvancedSettings={handleResetAdvancedSettings}
        // Sidebar expanded state callback
        onExpandedChange={setIsLeftSidebarExpanded}
      />

      {/* Right Sidebar - 3D Model Import / Object Explorer */}
      <RightSidebar
        isVisible={useSpeckleViewer}
        hasModelLoaded={(() => {
          // Check if there's a loaded model OR if any 3D Model Context has speckleData
          const hasGlobalModel = globalModelFile !== null;
          const hasConfigWithSpeckle = analysis.analysisConfigs.some(c =>
            c.type === '3d-model' && c.speckleData !== undefined
          );
          return hasGlobalModel || hasConfigWithSpeckle;
        })()}
        modelFile={globalModelFile}
        onModelFileChange={handleRightSidebarModelUpload}
        onExpandedChange={setIsRightSidebarExpanded}
      />
    </div>
  );
}

export default function Home() {
  return (
    <ErrorProvider>
      <SpeckleViewerProvider>
        <SpeckleSelectionModeProvider>
          <ErrorToast />
          <HomeContent />
        </SpeckleSelectionModeProvider>
      </SpeckleViewerProvider>
    </ErrorProvider>
  );
}
