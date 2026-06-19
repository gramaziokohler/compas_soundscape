/**
 * Soundscape Serializer
 *
 * Converts between runtime types (SoundGenerationConfig, SoundEvent) and
 * the serializable types used for Speckle/local persistence.
 */

import type { SoundGenerationConfig, SoundEvent, ReceiverData, SimulationConfig } from '@/types';
import type {
  SoundscapeSavePayload,
  SoundscapeSoundConfig,
  SoundscapeSoundEvent,
  SoundscapeGlobalSettings,
  SoundscapeData,
  SoundscapeReceiver,
  SoundscapeSimulationConfig,
  SoundscapeIRMetadata,
  SerializedAnalysisConfig,
  AnalysisState,
} from '@/types/soundscape';
import type { ImpulseResponseMetadata, SourceReceiverIRMapping, ResonanceAudioConfig } from '@/types/audio';
import type { AnalysisConfig, AnalysisResult, TextPromptResult } from '@/types/analysis';
import { API_BASE_URL } from '@/utils/constants';

/**
 * Extract the filename from a sound URL path.
 * e.g. "http://localhost:8000/static/sounds/generated/foo.wav" -> "foo.wav"
 *      "/static/sounds/generated/foo.wav" -> "foo.wav"
 *      "blob:http://..." -> "" (blob URLs can't be resolved to filenames)
 */
function extractFilename(url: string): string {
  if (!url || url.startsWith('blob:')) return '';
  try {
    // Handle full URLs
    const urlObj = new URL(url, API_BASE_URL);
    const pathname = urlObj.pathname;
    return pathname.split('/').pop() || '';
  } catch {
    // Fallback: just split by /
    return url.split('/').pop() || '';
  }
}

/**
 * Get a list of sound events that have blob URLs (need server upload before save).
 * These are library downloads and user-uploaded audio that only exist in browser memory.
 */
export function getBlobUrlSounds(soundEvents: SoundEvent[]): SoundEvent[] {
  return soundEvents.filter(
    (event) => event.url && event.url.startsWith('blob:')
  );
}

/**
 * Build a save payload from the current runtime state.
 *
 * @param modelId - Speckle model ID
 * @param modelName - Display name for the model
 * @param soundConfigs - Current SoundGenerationConfig array
 * @param soundscapeData - Current SoundEvent array (generated sounds in 3D)
 * @param globalSettings - Global generation settings
 * @returns Payload ready to POST to /api/speckle/soundscape/save
 */
export function buildSoundscapeSavePayload(
  modelId: string,
  modelName: string,
  soundConfigs: SoundGenerationConfig[],
  soundscapeData: SoundEvent[],
  globalSettings: {
    duration: number;
    steps: number;
    negativePrompt: string;
    audioModel: string;
  },
  /** User-adjusted volumes keyed by sound ID (from audioControls) */
  soundVolumes?: Record<string, number>,
  /** User-adjusted intervals keyed by sound ID (from audioControls) */
  soundIntervals?: Record<string, number>,
  /** Server filenames for blob-URL sounds (uploaded via upload-audio endpoint) */
  uploadedFilenames?: Record<string, string>,
  /** Receiver positions to persist */
  receivers?: ReceiverData[],
  /** Currently selected receiver ID */
  selectedReceiverId?: string | null,
  /** Simulation configurations to persist */
  simulationConfigs?: SimulationConfig[],
  /** Active simulation tab index */
  activeSimulationIndex?: number | null,
  /** Resonance Audio global config */
  resonanceAudioConfig?: ResonanceAudioConfig,
): SoundscapeSavePayload {
  // Map runtime configs to serializable configs
  const serializedConfigs: SoundscapeSoundConfig[] = soundConfigs.map(
    (config, index) => ({
      index,
      prompt: config.prompt || '',
      type: config.type || undefined,
      duration: config.duration,
      display_name: config.display_name || undefined,
      spl_db: config.spl_db,
      interval_seconds: config.interval_seconds,
      // Legacy single-entity fields (kept for backward compat with older saves)
      entity_index: config.entities?.[0]?.id !== undefined
        ? (typeof config.entities[0].id === 'number'
          ? config.entities[0].id as number
          : parseInt(config.entities[0].id as string, 10))
        : undefined,
      entity_node_id: config.entities?.[0]?.applicationId
        || config.entities?.[0]?.nodeId
        || (typeof config.entities?.[0]?.id === 'string' ? config.entities[0].id as string : undefined),
      // Multi-entity fields (new format)
      entity_indices: config.entities?.length
        ? (config.entities
            .map((e: any) => e.id !== undefined
              ? (typeof e.id === 'number' ? e.id as number : parseInt(e.id as string, 10))
              : undefined)
            .filter((i: number | undefined): i is number => i !== undefined))
        : undefined,
      entity_node_ids: config.entities?.length
        ? (config.entities
            .map((e: any) => e.applicationId || e.nodeId || (typeof e.id === 'string' ? e.id as string : undefined))
            .filter((id: string | undefined): id is string => !!id))
        : undefined,
      seed_copies: config.seed_copies,
      steps: config.steps,
      parent_usage_original_index: (config as any).parentUsageOriginalIndex,
    })
  );

      // Build a lookup: prompt_index → entity_node_ids[] (for event serialization)
      const configEntityNodeIds: Record<number, string> = {};
      serializedConfigs.forEach((c) => {
        // Use first entity_node_id for each config index (event matching only needs one)
        const firstId = c.entity_node_ids?.[0] || c.entity_node_id;
        if (firstId) configEntityNodeIds[c.index] = firstId;
      });

  // Map runtime sound events to serializable events and collect audio URLs
  const audioUrls: string[] = [];
  const serializedEvents: SoundscapeSoundEvent[] = soundscapeData.map(
    (event) => {
      // For blob URLs, use the pre-uploaded filename if available
      const uploadedFilename = uploadedFilenames?.[event.id];
      const filename = uploadedFilename || extractFilename(event.url);

      // Collect non-blob URLs for copying (server-side files)
      if (event.url && !event.url.startsWith('blob:')) {
        audioUrls.push(event.url);
      }

      // Merge user-adjusted volume/interval from audioControls maps
      // These override the SoundEvent's own current_* fields
      const adjustedVolume = soundVolumes?.[event.id] ?? event.current_volume_db;
      const adjustedInterval = soundIntervals?.[event.id] ?? event.current_interval_seconds;

      // Resolve entity_node_id from the matching config (events only have entity_index)
      const eventEntityNodeId = event.prompt_index !== undefined
        ? configEntityNodeIds[event.prompt_index]
        : undefined;

      return {
        id: event.id,
        audio_filename: filename,
        position: event.position ? [...event.position] : [0, 0, 0],
        display_name: event.display_name,
        prompt: event.prompt,
        prompt_index: event.prompt_index,
        volume_db: event.volume_db,
        current_volume_db: adjustedVolume,
        interval_seconds: event.interval_seconds,
        current_interval_seconds: adjustedInterval,
        is_uploaded: event.isUploaded || false,
        entity_index: event.entity_index,
        entity_node_id: eventEntityNodeId,
        entity_indices: event.entity_indices,
      };
    }
  );

  const settings: SoundscapeGlobalSettings = {
    duration: globalSettings.duration,
    steps: globalSettings.steps,
    negative_prompt: globalSettings.negativePrompt,
    audio_model: globalSettings.audioModel,
  };

  // Serialize receivers (strip non-serializable mesh property)
  const serializedReceivers: SoundscapeReceiver[] = (receivers || []).map((r) => ({
    id: r.id,
    name: r.name,
    position: [...r.position],
    type: (r as any).type || undefined,
    yaw: r.yaw,
    pitch: r.pitch,
    roll: r.roll,
  }));

  // Serialize simulation configs and collect IR URLs
  const irUrls: string[] = [];
  const serializedSimConfigs: SoundscapeSimulationConfig[] = [];

  for (const config of simulationConfigs || []) {
    if (config.type !== 'pyroomacoustics' && config.type !== 'import-irs' && config.type !== 'resonance') continue;

    const pyConfig = config as any;

    // Resonance cards: save minimal data only (settings live in resonance_audio_config)
    if (config.type === 'resonance') {
      serializedSimConfigs.push({
        id: config.id,
        display_name: config.display_name || config.id,
        type: config.type,
        state: config.state,
        simulation_instance_id: config.simulationInstanceId,
      });
      continue;
    }

    // Serialize source-receiver IR mapping and collect IR URLs
    let serializedMapping: Record<string, Record<string, SoundscapeIRMetadata>> | undefined;
    if (pyConfig.sourceReceiverIRMapping) {
      serializedMapping = {};
      const mapping = pyConfig.sourceReceiverIRMapping as SourceReceiverIRMapping;
      for (const [sourceId, receiverMap] of Object.entries(mapping)) {
        serializedMapping[sourceId] = {};
        for (const [receiverId, irMeta] of Object.entries(receiverMap)) {
          // Runtime IR metadata may use either camelCase (TS type) or
          // snake_case (raw backend JSON) — handle both gracefully
          const m = irMeta as any;
          const irUrl: string = m.url || '';
          const filename = extractFilename(irUrl);
          // Collect URL for backend copy
          if (irUrl && !irUrl.startsWith('blob:')) {
            irUrls.push(irUrl);
          }
          serializedMapping[sourceId][receiverId] = {
            id: m.id,
            url: irUrl,
            filename,
            name: m.name,
            format: m.format,
            channels: m.channels ?? 0,
            original_channels: m.originalChannels ?? m.original_channels ?? 0,
            sample_rate: m.sampleRate ?? m.sample_rate ?? 0,
            duration: m.duration ?? 0,
            file_size: m.fileSize ?? m.file_size ?? 0,
            normalization_convention: m.normalizationConvention ?? m.normalization_convention,
            channel_ordering: m.channelOrdering ?? m.channel_ordering,
          };
        }
      }
    }

    // Extract Speckle material assignments from the config
    // These are stored in AcousticMaterialContext and passed through the config
    const speckleMaterialAssignments = pyConfig.speckleMaterialAssignments as Record<string, string> | undefined;
    const speckleLayerName = pyConfig.speckleLayerName as string | undefined;
    const speckleGeometryObjectIds = pyConfig.speckleGeometryObjectIds as string[] | undefined;
    const speckleScatteringAssignments = pyConfig.speckleScatteringAssignments as Record<string, number> | undefined;

    // Build receiver position map from the receivers array
    // This captures the authoritative dragged positions at save time
    const receiverPositions: Record<string, number[]> = {};
    if (serializedMapping && receivers) {
      // Collect all receiver IDs referenced in the IR mapping
      const referencedReceiverIds = new Set<string>();
      for (const receiverMap of Object.values(serializedMapping)) {
        for (const receiverId of Object.keys(receiverMap)) {
          referencedReceiverIds.add(receiverId);
        }
      }
      // Look up positions from the receivers array
      for (const r of receivers) {
        if (referencedReceiverIds.has(r.id)) {
          receiverPositions[r.id] = [...r.position];
        }
      }
    }

    serializedSimConfigs.push({
      id: config.id,
      display_name: config.display_name || config.id,
      type: config.type,
      state: config.state,
      simulation_instance_id: config.simulationInstanceId,
      settings: pyConfig.settings ? {
        max_order: pyConfig.settings.max_order,
        ray_tracing: pyConfig.settings.ray_tracing,
        air_absorption: pyConfig.settings.air_absorption,
        n_rays: pyConfig.settings.n_rays,
        simulation_mode: pyConfig.settings.simulation_mode,
        enable_grid: pyConfig.settings.enable_grid,
      } : undefined,
      speckle_material_assignments: speckleMaterialAssignments,
      speckle_layer_name: speckleLayerName,
      speckle_geometry_object_ids: speckleGeometryObjectIds,
      speckle_scattering_assignments: speckleScatteringAssignments,
      simulation_results: pyConfig.simulationResults,
      current_simulation_id: pyConfig.currentSimulationId,
      imported_ir_ids: pyConfig.importedIRIds,
      source_receiver_ir_mapping: serializedMapping,
      receiver_positions: Object.keys(receiverPositions).length > 0 ? receiverPositions : undefined,
      ir_gain_db: pyConfig.irGainDb ?? undefined,
      ir_normalize_enabled: pyConfig.irNormalizeEnabled ?? undefined,
      material_assignments_enabled: pyConfig.materialAssignmentsEnabled ?? undefined,
    });
  }

  const soundscapePayload: SoundscapeData = {
    version: '1.0',
    model_id: modelId,
    model_name: modelName,
    created_at: new Date().toISOString(),
    global_settings: settings,
    sound_configs: serializedConfigs,
    sound_events: serializedEvents,
    receivers: serializedReceivers.length > 0 ? serializedReceivers : undefined,
    selected_receiver_id: selectedReceiverId ?? undefined,
    simulation_configs: serializedSimConfigs.length > 0 ? serializedSimConfigs : undefined,
    active_simulation_index: activeSimulationIndex ?? undefined,
    resonance_audio_config: resonanceAudioConfig ? {
      enabled: resonanceAudioConfig.enabled,
      ambisonic_order: resonanceAudioConfig.ambisonicOrder,
      room_dimensions: resonanceAudioConfig.roomDimensions,
      room_materials: {
        left: resonanceAudioConfig.roomMaterials.left,
        right: resonanceAudioConfig.roomMaterials.right,
        front: resonanceAudioConfig.roomMaterials.front,
        back: resonanceAudioConfig.roomMaterials.back,
        down: resonanceAudioConfig.roomMaterials.down,
        up: resonanceAudioConfig.roomMaterials.up,
      },
    } : undefined,
  };

  return {
    soundscape_data: soundscapePayload,
    audio_urls: audioUrls,
    ir_urls: irUrls,
  };
}

/**
 * Restore runtime state from loaded soundscape data.
 *
 * @param loadedData - SoundscapeData from the backend
 * @param audioBaseUrl - Base URL to prepend to audio filenames
 * @returns Objects ready to feed into useSoundGeneration setters
 */
export function restoreSoundscapeState(
  loadedData: SoundscapeData,
  audioBaseUrl: string,
  irBaseUrl?: string,
): {
  soundConfigs: SoundGenerationConfig[];
  soundEvents: SoundEvent[];
  soundVolumes: Record<string, number>;
  soundIntervals: Record<string, number>;
  globalSettings: {
    duration: number;
    steps: number;
    negativePrompt: string;
    audioModel: string;
  };
  receivers: ReceiverData[];
  selectedReceiverId: string | null;
  simulationConfigs: SimulationConfig[];
  activeSimulationIndex: number | null;
  resonanceAudioConfig: ResonanceAudioConfig | null;
} {
  // Rebuild SoundGenerationConfig[] from saved configs
  const soundConfigs: SoundGenerationConfig[] = loadedData.sound_configs.map(
    (saved) => ({
      prompt: saved.prompt,
      duration: saved.duration,
      negative_prompt: loadedData.global_settings.negative_prompt || '',
      seed_copies: saved.seed_copies,
      steps: saved.steps,
      display_name: saved.display_name,
      spl_db: saved.spl_db,
      interval_seconds: saved.interval_seconds,
      type: saved.type as SoundGenerationConfig['type'],
      parentUsageOriginalIndex: (saved as any).parent_usage_original_index,
      entity: undefined, // deprecated — use entities[] below
      entities: (() => {
        // New multi-entity format: entity_indices[] array
        if (saved.entity_indices?.length) {
          return saved.entity_indices.map((idx: number, i: number) => ({
            id: saved.entity_node_ids?.[i] || String(idx),
            nodeId: saved.entity_node_ids?.[i],
            applicationId: saved.entity_node_ids?.[i],
            index: idx,
          }));
        }
        // Backward compat: old single entity_index format
        if (saved.entity_index != null) {
          return [{
            // entity_node_id is a stable applicationId (Rhino GUID) —
            // the actual Speckle tree ID must be resolved at runtime via appIdToTreeIdMap.
            id: saved.entity_node_id || String(saved.entity_index),
            nodeId: saved.entity_node_id,
            applicationId: saved.entity_node_id,
            index: saved.entity_index,
          }];
        }
        return undefined;
      })(),
    })
  );

  // Normalize the base URL (remove trailing slash)
  const baseUrl = audioBaseUrl.replace(/\/$/, '');

  // Rebuild user-adjusted volume/interval maps (keyed by sound ID)
  const soundVolumes: Record<string, number> = {};
  const soundIntervals: Record<string, number> = {};

  // Rebuild SoundEvent[] with resolved audio URLs
  // Include events with empty audio_filename (uploaded/sample sounds) —
  // they keep the card in "generated" state even though audio needs re-upload
  const soundEvents: SoundEvent[] = loadedData.sound_events.map((saved) => {
    const hasAudio = !!saved.audio_filename;
    const url = hasAudio ? `${baseUrl}/${saved.audio_filename}` : '';

    // Populate user-adjusted volume/interval maps from current_* fields
    if (saved.current_volume_db != null) {
      soundVolumes[saved.id] = saved.current_volume_db;
    }
    if (saved.current_interval_seconds != null) {
      soundIntervals[saved.id] = saved.current_interval_seconds;
    }

    // Build the event — only include entity_index when it's a real number.
    // In JS, null !== undefined and the sphere manager checks
    // `entity_index === undefined` to decide whether to render a sphere.
    const event: SoundEvent = {
      id: saved.id,
      url,
      position: saved.position as [number, number, number],
      geometry: { vertices: [], faces: [] },
      display_name: saved.display_name,
      prompt: saved.prompt,
      prompt_index: saved.prompt_index,
      volume_db: saved.volume_db,
      current_volume_db: saved.current_volume_db ?? undefined,
      interval_seconds: saved.interval_seconds,
      current_interval_seconds: saved.current_interval_seconds ?? undefined,
      isUploaded: saved.is_uploaded,
    };

    // Only set entity_index when it's a real number (not null/undefined)
    // so that the sphere manager's `=== undefined` check works correctly
    if (saved.entity_index != null) {
      event.entity_index = saved.entity_index;
    }
    // Restore multi-entity indices
    if (saved.entity_indices?.length) {
      event.entity_indices = saved.entity_indices;
    } else if (saved.entity_index != null) {
      event.entity_indices = [saved.entity_index];
    }

    return event;
  });

  const globalSettings = {
    duration: loadedData.global_settings.duration,
    steps: loadedData.global_settings.steps,
    negativePrompt: loadedData.global_settings.negative_prompt,
    audioModel: loadedData.global_settings.audio_model,
  };

  // Build authoritative receiver position map from simulation configs
  // (simulation data has the correct positions even if the receivers array is stale)
  const simReceiverPositions: Record<string, number[]> = {};
  for (const simConfig of loadedData.simulation_configs || []) {
    if (simConfig.receiver_positions) {
      for (const [receiverId, pos] of Object.entries(simConfig.receiver_positions)) {
        simReceiverPositions[receiverId] = pos;
      }
    }
  }

  // Restore receivers — prefer positions from simulation data over the receivers array
  const restoredReceivers: ReceiverData[] = (loadedData.receivers || []).map((saved) => ({
    id: saved.id,
    name: saved.name,
    position: (simReceiverPositions[saved.id] ?? saved.position) as [number, number, number],
    yaw: (saved as any).yaw ?? 0,
    pitch: (saved as any).pitch ?? 0,
    roll: (saved as any).roll ?? 0,
  }));

  const selectedReceiverId = loadedData.selected_receiver_id ?? null;

  // Normalize IR base URL
  const irBase = irBaseUrl?.replace(/\/$/, '') || '';

  // Restore simulation configs
  const restoredSimConfigs: SimulationConfig[] = (loadedData.simulation_configs || []).map((saved) => {
    // Rebuild sourceReceiverIRMapping with rewritten URLs pointing to persistent ir_files folder
    let sourceReceiverIRMapping: SourceReceiverIRMapping | undefined;
    if (saved.source_receiver_ir_mapping && irBase) {
      sourceReceiverIRMapping = {};
      for (const [sourceId, receiverMap] of Object.entries(saved.source_receiver_ir_mapping)) {
        sourceReceiverIRMapping[sourceId] = {};
        for (const [receiverId, irData] of Object.entries(receiverMap)) {
          // Rewrite URL to point to persistent ir_files folder
          const rewrittenUrl = irData.filename ? `${irBase}/${irData.filename}` : irData.url;
          // Runtime IR metadata uses snake_case (raw backend JSON, no conversion
          // in apiService.uploadImpulseResponse). Provide both camelCase and
          // snake_case keys so the object works everywhere in the codebase.
          const irMetadata: any = {
            id: irData.id,
            url: rewrittenUrl,
            name: irData.name,
            format: irData.format,
            channels: irData.channels,
            // snake_case (matches raw backend response)
            original_channels: irData.original_channels,
            sample_rate: irData.sample_rate,
            duration: irData.duration,
            file_size: irData.file_size,
            normalization_convention: irData.normalization_convention,
            channel_ordering: irData.channel_ordering,
            // camelCase aliases (for any code that uses TS interface keys)
            originalChannels: irData.original_channels,
            sampleRate: irData.sample_rate,
            fileSize: irData.file_size,
            normalizationConvention: irData.normalization_convention,
            channelOrdering: irData.channel_ordering,
          };
          sourceReceiverIRMapping[sourceId][receiverId] = irMetadata;
        }
      }
    }

    const hasSettings = !!saved.settings;
    const settings = saved.settings!;

    // Build the runtime SimulationConfig
    const restoredConfig: SimulationConfig = {
      id: saved.id,
      display_name: saved.display_name,
      type: saved.type as SimulationConfig['type'],
      state: (saved.state || 'completed') as SimulationConfig['state'],
      createdAt: Date.now(),
      simulationInstanceId: saved.simulation_instance_id,
      settings: hasSettings ? {
        max_order: settings.max_order,
        ray_tracing: settings.ray_tracing,
        air_absorption: settings.air_absorption,
        n_rays: settings.n_rays,
        simulation_mode: settings.simulation_mode,
        enable_grid: settings.enable_grid,
      } : {
        max_order: 3,
        ray_tracing: false,
        air_absorption: true,
        n_rays: 10000,
        simulation_mode: 'foa',
        enable_grid: false,
      },
      // Runtime defaults
      faceToMaterialMap: new Map(),
      isRunning: false,
      progress: 0,
      status: 'Complete!',
      error: null,
      // Restored state
      simulationResults: saved.simulation_results ?? null,
      currentSimulationId: saved.current_simulation_id,
      importedIRIds: saved.imported_ir_ids,
      sourceReceiverIRMapping,
      // Speckle material assignments (attached as any for pass-through)
      speckleMaterialAssignments: saved.speckle_material_assignments,
      speckleLayerName: saved.speckle_layer_name,
      speckleGeometryObjectIds: saved.speckle_geometry_object_ids,
      speckleScatteringAssignments: saved.speckle_scattering_assignments,
      // Import-IRs advanced settings
      irGainDb: saved.ir_gain_db ?? undefined,
      irNormalizeEnabled: saved.ir_normalize_enabled ?? undefined,
      materialAssignmentsEnabled: saved.material_assignments_enabled ?? undefined,
    } as any;

    if (!hasSettings) {
      delete (restoredConfig as any).settings;
      delete (restoredConfig as any).faceToMaterialMap;
    }

    return restoredConfig;
  });

  const activeSimulationIndex = loadedData.active_simulation_index ?? null;

  const resonanceAudioConfig: ResonanceAudioConfig | null = loadedData.resonance_audio_config ? {
    enabled: loadedData.resonance_audio_config.enabled,
    ambisonicOrder: loadedData.resonance_audio_config.ambisonic_order,
    roomDimensions: loadedData.resonance_audio_config.room_dimensions,
    roomMaterials: loadedData.resonance_audio_config.room_materials,
  } : null;

  return {
    soundConfigs,
    soundEvents,
    soundVolumes,
    soundIntervals,
    globalSettings,
    receivers: restoredReceivers,
    selectedReceiverId,
    simulationConfigs: restoredSimConfigs,
    activeSimulationIndex,
    resonanceAudioConfig,
  };
}

// ============================================================================
// Analysis State Serialization (Hierarchical)
// ============================================================================

function stripEntityRaw(entity: any): any {
  if (!entity) return entity;
  const { raw, ...rest } = entity;
  return rest;
}

export function buildAnalysisStateSave(
  analysisConfigs: AnalysisConfig[],
  analysisResults: AnalysisResult[],
  pendingSoundConfigs: any[],
  activeTab: number,
  soundConfigs?: Array<{ parentUsageOriginalIndex?: number }>,
  cardFlowState?: { contextAdvanced: number[]; usageAdvanced: number[]; contextToUsage: Record<number, number[]>; usageToSound: Record<number, number[]> },
): { analysis_state: AnalysisState; analysis_ids: string[]; scenario_ids: string[] } {
  const resultsByIndex = new Map<number, AnalysisResult>();
  for (const r of analysisResults) {
    resultsByIndex.set(r.configIndex, r);
  }

  const configs: SerializedAnalysisConfig[] = analysisConfigs.map((config, configIndex) => {
    const base: SerializedAnalysisConfig = {
      type: config.type,
      display_name: (config as any).display_name,
      parentContextOriginalIndex: (config as any).parentContextOriginalIndex,
    };

    if ('numSounds' in config) base.numSounds = (config as any).numSounds;
    if ('textInput' in config) base.textInput = (config as any).textInput;
    if ('userContext' in config) base.userContext = (config as any).userContext;
    if ('useModelAsContext' in config) base.useModelAsContext = (config as any).useModelAsContext;
    if ('useAnalysisResult' in config) base.useAnalysisResult = (config as any).useAnalysisResult;
    if ('peopleCount' in config) base.peopleCount = (config as any).peopleCount;
    if ('likeliness' in config) base.likeliness = (config as any).likeliness;
    if ('analysisOptions' in config) base.analysisOptions = (config as any).analysisOptions;
    if ('applyNoiseReduction' in config) base.applyNoiseReduction = (config as any).applyNoiseReduction;

    const result = resultsByIndex.get(configIndex);
    if (result && result.prompts.length > 0) {
      base.prompts = result.prompts.map((p) => ({
        id: p.id,
        text: p.text,
        displayName: p.displayName,
        selected: p.selected,
        entities: p.entities?.map(stripEntityRaw),
        position: p.position,
        metadata: p.metadata as Record<string, unknown> | undefined,
      }));
    }

    if (config.type === 'model-analysis') {
      const mc = config as any;
      if (mc.analysisResult?.architecturalObjects) {
        base.analysisResult = {
          analysisId: mc.analysisResult.analysisId,
          architecturalObjects: mc.analysisResult.architecturalObjects,
        };
      }
    }

    if (config.type === '3d-model') {
      const tc = config as any;
      if (tc.selectedDiverseEntities?.length) {
        base.selectedDiverseEntities = tc.selectedDiverseEntities.map(stripEntityRaw);
      }
    }

    if (config.type === 'scenario') {
      const sc = config as any;
      if (sc.scenarioResult) base.scenarioResult = sc.scenarioResult;
      if (sc.scenarioId) base.scenarioId = sc.scenarioId;
      if (sc.foleyResult) base.foleyResult = sc.foleyResult;
      if (sc.selectedFoleyKeys?.length) base.selectedFoleyKeys = [...sc.selectedFoleyKeys];
    }

    // Hierarchical: link child sound configs by matching parentUsageOriginalIndex
    if (soundConfigs && (config.type === 'model-analysis' || config.type === 'text' || config.type === 'audio' || config.type === '3d-model' || config.type === 'scenario')) {
      const childIndices: number[] = [];
      soundConfigs.forEach((sc, si) => {
        if (sc.parentUsageOriginalIndex === configIndex) {
          childIndices.push(si);
        }
      });
      if (childIndices.length > 0) {
        base.sound_config_indices = childIndices;
      }
    }

    return base;
  });

  const analysis_ids: string[] = [];
  const scenario_ids: string[] = [];
  for (const config of analysisConfigs) {
    if (config.type === 'model-analysis') {
      const mc = config as any;
      if (mc.analysisResult?.analysisId) analysis_ids.push(mc.analysisResult.analysisId);
    }
    if (config.type === 'scenario') {
      const sc = config as any;
      if (sc.scenarioId) scenario_ids.push(sc.scenarioId);
      if (sc.foleyResult?.foleyId) scenario_ids.push(sc.foleyResult.foleyId);
    }
  }

  const analysisState: AnalysisState = {
    active_tab: activeTab,
    configs,
    pending_sound_configs: pendingSoundConfigs.length > 0 ? pendingSoundConfigs : undefined,
  };

  if (cardFlowState) {
    analysisState.card_flow = {
      contextAdvanced: cardFlowState.contextAdvanced,
      usageAdvanced: cardFlowState.usageAdvanced,
      contextToUsageMap: cardFlowState.contextToUsage,
      usageToSoundMap: cardFlowState.usageToSound,
    };
  }

  return {
    analysis_state: analysisState,
    analysis_ids,
    scenario_ids,
  };
}

export function restoreAnalysisState(analysisState: AnalysisState): {
  analysisConfigs: AnalysisConfig[];
  analysisResults: AnalysisResult[];
  activeTab: number;
  pendingSoundConfigs: any[];
  soundConfigParentIndices: Map<number, number>;
  cardFlowState: {
    contextAdvanced: number[];
    usageAdvanced: number[];
    contextToUsage: Record<number, number[]>;
    usageToSound: Record<number, number[]>;
  } | null;
} {
  const analysisResults: AnalysisResult[] = [];

  const analysisConfigs: AnalysisConfig[] = analysisState.configs.map((saved, configIndex) => {
    const config: any = {
      type: saved.type,
      display_name: saved.display_name,
      parentContextOriginalIndex: saved.parentContextOriginalIndex,
    };

    if (saved.numSounds !== undefined) config.numSounds = saved.numSounds;
    if (saved.textInput !== undefined) config.textInput = saved.textInput;
    if (saved.userContext !== undefined) config.userContext = saved.userContext;
    if (saved.useModelAsContext !== undefined) config.useModelAsContext = saved.useModelAsContext;
    if (saved.useAnalysisResult !== undefined) config.useAnalysisResult = saved.useAnalysisResult;
    if (saved.peopleCount !== undefined) config.peopleCount = saved.peopleCount;
    if (saved.likeliness !== undefined) config.likeliness = saved.likeliness;
    if (saved.analysisOptions) config.analysisOptions = saved.analysisOptions;
    if (saved.applyNoiseReduction !== undefined) config.applyNoiseReduction = saved.applyNoiseReduction;

    if (saved.type === 'model-analysis') {
      config.liveScreenshots = [];
      config.modelEntities = [];
      if (saved.analysisResult) config.analysisResult = saved.analysisResult;
    }
    if (saved.type === '3d-model') {
      config.modelFile = null;
      config.modelEntities = [];
      config.geometryData = undefined;
      config.selectedDiverseEntities = saved.selectedDiverseEntities || [];
      config.useModelAsContext = saved.useModelAsContext ?? true;
    }
    if (saved.type === 'audio') {
      config.audioFile = null;
      config.audioInfo = null;
      config.audioBuffer = null;
    }
    if (saved.type === 'scenario') {
      config.scenarioRawText = '';
      config.scenarioResult = saved.scenarioResult || null;
      config.scenarioId = saved.scenarioId ?? null;
      config.foleyResult = saved.foleyResult || null;
      config.selectedFoleyKeys = saved.selectedFoleyKeys || [];
    }

    if (saved.prompts && saved.prompts.length > 0) {
      analysisResults.push({
        configIndex,
        prompts: saved.prompts.map((p) => ({
          id: p.id,
          text: p.text,
          displayName: p.displayName,
          selected: p.selected,
          entities: p.entities,
          position: p.position,
          metadata: p.metadata as any,
        })) as TextPromptResult[],
      });
    }

    return config as AnalysisConfig;
  });

  return {
    analysisConfigs,
    analysisResults,
    activeTab: analysisState.active_tab,
    pendingSoundConfigs: analysisState.pending_sound_configs || [],
    soundConfigParentIndices: buildParentIndexMap(analysisState.configs),
    cardFlowState: analysisState.card_flow
      ? {
          contextAdvanced: analysisState.card_flow.contextAdvanced,
          usageAdvanced: analysisState.card_flow.usageAdvanced,
          contextToUsage: analysisState.card_flow.contextToUsageMap,
          usageToSound: analysisState.card_flow.usageToSoundMap,
        }
      : null,
  };
}

function buildParentIndexMap(configs: SerializedAnalysisConfig[]): Map<number, number> {
  const map = new Map<number, number>();
  configs.forEach((saved, configIndex) => {
    if (saved.sound_config_indices) {
      for (const si of saved.sound_config_indices) {
        map.set(si, configIndex);
      }
    }
  });
  return map;
}
