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
} from '@/types/soundscape';
import type { ImpulseResponseMetadata, SourceReceiverIRMapping } from '@/types/audio';

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
    const urlObj = new URL(url, 'http://localhost');
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
      entity_index: config.entity?.id !== undefined
        ? (typeof config.entity.id === 'number'
          ? config.entity.id
          : parseInt(config.entity.id, 10))
        : undefined,
      // Save full Speckle hash for exact entity matching on load
      entity_node_id: config.entity?.nodeId
        || (typeof config.entity?.id === 'string' ? config.entity.id : undefined),
      seed_copies: config.seed_copies,
      steps: config.steps,
    })
  );

  // Build a lookup: prompt_index → entity_node_id (for event serialization)
  const configEntityNodeIds: Record<number, string> = {};
  serializedConfigs.forEach((c) => {
    if (c.entity_node_id) configEntityNodeIds[c.index] = c.entity_node_id;
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
  }));

  // Serialize simulation configs and collect IR URLs
  const irUrls: string[] = [];
  const serializedSimConfigs: SoundscapeSimulationConfig[] = [];

  for (const config of simulationConfigs || []) {
    if (config.type !== 'pyroomacoustics') continue;

    const pyConfig = config as any;

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
      entity: saved.entity_index !== undefined && saved.entity_index !== null
        ? {
            // Prefer the full hash for proper Speckle matching & coloring
            id: saved.entity_node_id || saved.entity_index,
            nodeId: saved.entity_node_id,
            index: saved.entity_index,
          }
        : undefined,
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

    // Build the runtime SimulationConfig (PyroomAcousticsSimulationConfig)
    const restoredConfig: SimulationConfig = {
      id: saved.id,
      display_name: saved.display_name,
      type: saved.type as SimulationConfig['type'],
      state: (saved.state || 'completed') as SimulationConfig['state'],
      createdAt: Date.now(),
      simulationInstanceId: saved.simulation_instance_id,
      settings: saved.settings ? {
        max_order: saved.settings.max_order,
        ray_tracing: saved.settings.ray_tracing,
        air_absorption: saved.settings.air_absorption,
        n_rays: saved.settings.n_rays,
        simulation_mode: saved.settings.simulation_mode,
        enable_grid: saved.settings.enable_grid,
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
    } as any;

    return restoredConfig;
  });

  const activeSimulationIndex = loadedData.active_simulation_index ?? null;

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
  };
}
