"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { AudioWaveformDisplay } from "@/components/audio/AudioWaveformDisplay";
import { MiniIRWaveform } from "@/components/audio/MiniIRWaveform";
import { FileUploadArea } from "@/components/controls/FileUploadArea";
import { apiService } from "@/services/api";
import { useApiErrorHandler } from "@/hooks/useApiErrorHandler";
import { Notice } from '@/components/ui/Notice';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import type { ImpulseResponseMetadata, SourceReceiverIRMapping } from "@/types/audio";
import { API_BASE_URL, IR_HOVER_LINE, IR_LOW_ENERGY_THRESHOLD, SIMULATION_POSITION_MATCH_THRESHOLD } from "@/utils/constants";
import { trimDisplayName } from "@/utils/utils";
import { parsePositionKey } from "@/utils/positionKey";

type SourceReceiverPair = {
  sourceId: string;
  receiverId: string;
};

interface ImpulseResponseUploadProps {
  onClearIR: () => void;
  simulationResults?: string | null;
  refreshTrigger?: number;
  simulationIRIds?: string[];
  sourceReceiverIRMapping?: SourceReceiverIRMapping;
  onIRHover?: (sourceId: string | null, receiverId: string | null) => void;
  onLowEnergyIdsChange?: (ids: Set<string>) => void;
  sourceDisplayNames?: Record<string, string>;
  receiverDisplayNames?: Record<string, string>;
  /** Simulated source positions keyed by source posKey (for IR row labels) */
  simulationSourcePositions?: Record<string, [number, number, number]>;
  /** Current per-sound positions keyed by sound ID (for sounds-in-position count) */
  currentSoundPositions?: Record<string, [number, number, number]>;
  /** Maps each receiver ID → { groupId, groupName } for grouping grid listener points by parent */
  receiverGroups?: Record<string, { groupId: string; groupName: string }>;
  /** Called when user clicks the Go-To Listener button next to a receiver group */
  onGoToReceiver?: (receiverId: string) => void;
  /** Increments when FPS mode exits — clears the active listener border */
  fpsExitTrigger?: number;
  /** When set, scrolls to and highlights the corresponding IR group (e.g. after scene double-click) */
  forcedActiveGroupId?: string | null;
  pairDefinitions?: SourceReceiverPair[];
  availableSourceCount?: number;
  availableReceiverCount?: number;
  allowPairUploads?: boolean;
  onPairIRUploaded?: (sourceId: string, receiverId: string, ir: ImpulseResponseMetadata) => void;
  onPairAssignmentCleared?: (sourceId: string, receiverId: string) => void;
  /** When true, render a single IR upload slot per listener (applied to all its source pairs) */
  singleIRPerListener?: boolean;
  /** Called when a single IR is uploaded for a listener — applies to every pair under it */
  onListenerIRUploaded?: (pairs: SourceReceiverPair[], ir: ImpulseResponseMetadata) => void;
  /** Called when the single IR for a listener is cleared — clears every pair under it */
  onListenerAssignmentCleared?: (pairs: SourceReceiverPair[]) => void;
}

type ReceiverGroup = {
  groupId: string;
  groupName: string;
  sources: Array<{ sourceId: string; receiverId: string; ir: ImpulseResponseMetadata | null }>;
};

export function ImpulseResponseUpload({
  onClearIR,
  simulationResults = null,
  refreshTrigger = 0,
  simulationIRIds = undefined,
  sourceReceiverIRMapping,
  onIRHover,
  onLowEnergyIdsChange,
  sourceDisplayNames,
  receiverDisplayNames,
  simulationSourcePositions,
  currentSoundPositions,
  receiverGroups,
  onGoToReceiver,
  fpsExitTrigger,
  forcedActiveGroupId,
  pairDefinitions,
  availableSourceCount = 0,
  availableReceiverCount = 0,
  allowPairUploads = false,
  onPairIRUploaded,
  onPairAssignmentCleared,
  singleIRPerListener = false,
  onListenerIRUploaded,
  onListenerAssignmentCleared,
}: ImpulseResponseUploadProps) {
  const handleError = useApiErrorHandler();
  const [impulseResponses, setImpulseResponses] = useState<ImpulseResponseMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string>('');

  const [bufferCache, setBufferCache] = useState<Map<string, AudioBuffer>>(new Map());
  const [bufferLoadingIds, setBufferLoadingIds] = useState<Set<string>>(new Set());
  // Dedupes concurrent buffer loads of the same IR (effects + hover can race).
  const bufferLoadPromisesRef = useRef<Map<string, Promise<AudioBuffer | null>>>(new Map());
  const [lowEnergyIRIds, setLowEnergyIRIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [draggingPairKey, setDraggingPairKey] = useState<string | null>(null);
  const irLibraryFileInputRef = useRef<HTMLInputElement>(null);
  const simulationIRIdsKey = useMemo(() => (simulationIRIds ?? []).join('|'), [simulationIRIds]);

  // Collapsed receiver groups (empty = all expanded)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });
  }, []);

  // Active listener group (highlighted with primary border after Go-to-Listener click)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  // Clear active group when FPS mode exits
  useEffect(() => {
    if (fpsExitTrigger !== undefined) setActiveGroupId(null);
  }, [fpsExitTrigger]);

  // Scroll container and per-group element refs
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const groupEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const setGroupRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) groupEls.current.set(id, el);
    else groupEls.current.delete(id);
  }, []);

  // When forcedActiveGroupId changes, highlight and scroll to that group
  useEffect(() => {
    setActiveGroupId(forcedActiveGroupId ?? null);
    if (!forcedActiveGroupId) return;
    setCollapsedGroups(prev => { const n = new Set(prev); n.delete(forcedActiveGroupId); return n; });
    setTimeout(() => {
      const groupEl = groupEls.current.get(forcedActiveGroupId);
      const container = scrollContainerRef.current;
      if (groupEl && container) {
        const cRect = container.getBoundingClientRect();
        const gRect = groupEl.getBoundingClientRect();
        if (gRect.top < cRect.top || gRect.bottom > cRect.bottom) {
          container.scrollTop += gRect.top - cRect.top - cRect.height / 3;
        }
      }
    }, 50);
  }, [forcedActiveGroupId]);

  // Hover state for waveform overlay
  const [hoveredIRId, setHoveredIRId] = useState<string | null>(null);
  const [hoveredIRBuffer, setHoveredIRBuffer] = useState<AudioBuffer | null>(null);
  const [overlayPosition, setOverlayPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const [isOverlayHovered, setIsOverlayHovered] = useState(false);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => { loadImpulseResponses(); }, [refreshTrigger, simulationIRIdsKey]);

  // Fast metadata-based energy check (no audio download needed).
  // Uses peak_amplitude from the server response when available, so very short
  // IRs (where int16 quantisation collapses all samples to 0) are still detected
  // regardless of any browser AudioContext limitations.
  useEffect(() => {
    for (const ir of impulseResponses) {
      const peak = (ir as any).peak_amplitude ?? ir.peakAmplitude;
      if (peak !== undefined && peak !== null && peak < IR_LOW_ENERGY_THRESHOLD) {
        setLowEnergyIRIds(prev => prev.has(ir.id) ? prev : new Set(prev).add(ir.id));
      }
    }
  }, [impulseResponses]);

  // Buffer load for waveform hover preview; also catches energy for legacy IRs
  // that pre-date the peak_amplitude metadata field.
  useEffect(() => {
    for (const ir of impulseResponses) {
      if (!bufferCache.has(ir.id)) loadIRBuffer(ir);
    }
  }, [impulseResponses]);

  useEffect(() => { onLowEnergyIdsChange?.(lowEnergyIRIds); }, [lowEnergyIRIds, onLowEnergyIdsChange]);

  const loadImpulseResponses = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const irs = await apiService.listImpulseResponses();
      const filteredIRs = simulationIRIds
        ? irs.filter(ir => simulationIRIds.includes(ir.id))
        : irs;
      setImpulseResponses(filteredIRs);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load impulse responses';
      setError(errorMessage);
      handleError(err, errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const loadIRBuffer = (ir: ImpulseResponseMetadata): Promise<AudioBuffer | null> => {
    const cached = bufferCache.get(ir.id);
    if (cached) return Promise.resolve(cached);
    const inflight = bufferLoadPromisesRef.current.get(ir.id);
    if (inflight) return inflight;

    setBufferLoadingIds(prev => prev.has(ir.id) ? prev : new Set(prev).add(ir.id));
    const p = (async () => {
      try {
        const fullUrl = `${API_BASE_URL}${ir.url}`;
        const response = await fetch(fullUrl);
        if (!response.ok) throw new Error(`Failed to download IR: ${response.statusText}`);
        const audioBlob = await response.blob();
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        let peakSum = 0;
        for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
          const data = audioBuffer.getChannelData(ch);
          let chPeak = 0;
          for (let i = 0; i < data.length; i++) { const abs = Math.abs(data[i]); if (abs > chPeak) chPeak = abs; }
          peakSum += chPeak;
        }
        if (peakSum / audioBuffer.numberOfChannels < IR_LOW_ENERGY_THRESHOLD) {
          setLowEnergyIRIds(prev => new Set(prev).add(ir.id));
        }
        setBufferCache(prev => { const m = new Map(prev); m.set(ir.id, audioBuffer); return m; });
        return audioBuffer;
      } catch (err) {
        console.error(`Failed to load IR buffer for ${ir.name}:`, err);
        return null;
      } finally {
        bufferLoadPromisesRef.current.delete(ir.id);
        setBufferLoadingIds(prev => {
          const n = new Set(prev);
          n.delete(ir.id);
          return n;
        });
      }
    })();
    bufferLoadPromisesRef.current.set(ir.id, p);
    return p;
  };

  /** Downloads the exact IR WAV file (original bytes, not the decoded/re-encoded buffer). */
  const handleDownloadIR = useCallback(async (ir: ImpulseResponseMetadata) => {
    try {
      const fullUrl = `${API_BASE_URL}${ir.url}`;
      const response = await fetch(fullUrl);
      if (!response.ok) throw new Error(`Failed to download IR: ${response.statusText}`);
      const blob = await response.blob();
      const extMatch = ir.url.match(/\.[^./]+$/);
      const filename = `${ir.name || 'impulse-response'}${extMatch ? extMatch[0] : '.wav'}`;

      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to download IR';
      setError(errorMessage);
      handleError(err, errorMessage);
    }
  }, [handleError]);

  const uploadFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    setIsUploading(true);
    setError(null);
    try {
      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        setUploadProgress(`Uploading ${i + 1} of ${fileArray.length}...`);
        await apiService.uploadImpulseResponse(file, file.name.replace(/\.[^/.]+$/, ''));
      }
      setUploadProgress('All uploads complete!');
      await loadImpulseResponses();
      setTimeout(() => setUploadProgress(''), 2000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Upload failed';
      setError(errorMessage);
      handleError(err, errorMessage);
      setUploadProgress('');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files.length > 0) await uploadFiles(e.dataTransfer.files);
  };
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) { await uploadFiles(e.target.files); e.target.value = ''; }
  };
  const handleIRLibraryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) { await uploadFiles(e.target.files); e.target.value = ''; }
  };

  const uploadPairIR = async (files: FileList | File[], sourceId: string, receiverId: string) => {
    const file = Array.from(files)[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);

    try {
      setUploadProgress(`Uploading IR for ${trimDisplayName(sourceDisplayNames?.[sourceId] ?? sourceId)}...`);
      const uploaded = await apiService.uploadImpulseResponse(file, file.name.replace(/\.[^/.]+$/, ''));
      onPairIRUploaded?.(sourceId, receiverId, uploaded);
      setUploadProgress('IR imported');
      await loadImpulseResponses();
      setTimeout(() => setUploadProgress(''), 2000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Pair IR upload failed';
      setError(errorMessage);
      handleError(err, errorMessage);
      setUploadProgress('');
    } finally {
      setIsUploading(false);
    }
  };

  const buildPairKey = (sourceId: string, receiverId: string) => `${sourceId}::${receiverId}`;

  const handlePairFileChange = (sourceId: string, receiverId: string) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      await uploadPairIR(e.target.files, sourceId, receiverId);
      e.target.value = '';
    }
  };

  const handlePairDragOver = (pairKey: string) => (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDraggingPairKey(pairKey);
  };

  const handlePairDragLeave = (pairKey: string) => (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (draggingPairKey === pairKey) setDraggingPairKey(null);
  };

  const handlePairDrop = (sourceId: string, receiverId: string, pairKey: string) => async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (draggingPairKey === pairKey) setDraggingPairKey(null);
    if (e.dataTransfer.files.length > 0) {
      await uploadPairIR(e.dataTransfer.files, sourceId, receiverId);
    }
  };

  // ── Single-IR-per-listener upload (applies one IR to all of a listener's pairs) ──
  const uploadListenerIR = async (files: FileList | File[], pairs: SourceReceiverPair[]) => {
    const file = Array.from(files)[0];
    if (!file || pairs.length === 0) return;

    setIsUploading(true);
    setError(null);

    try {
      setUploadProgress('Uploading IR for listener...');
      const uploaded = await apiService.uploadImpulseResponse(file, file.name.replace(/\.[^/.]+$/, ''));
      onListenerIRUploaded?.(pairs, uploaded);
      setUploadProgress('IR imported');
      await loadImpulseResponses();
      setTimeout(() => setUploadProgress(''), 2000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Listener IR upload failed';
      setError(errorMessage);
      handleError(err, errorMessage);
      setUploadProgress('');
    } finally {
      setIsUploading(false);
    }
  };

  const handleListenerFileChange = (pairs: SourceReceiverPair[]) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      await uploadListenerIR(e.target.files, pairs);
      e.target.value = '';
    }
  };

  const handleListenerDrop = (pairs: SourceReceiverPair[], pairKey: string) => async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (draggingPairKey === pairKey) setDraggingPairKey(null);
    if (e.dataTransfer.files.length > 0) {
      await uploadListenerIR(e.dataTransfer.files, pairs);
    }
  };

  const formatChannelLabel = (channelCount: number): string => {
    if (channelCount === 1) return 'Mono';
    if (channelCount === 2) return 'Stereo';
    if (channelCount === 4) return '4-Channel (FOA)';
    if (channelCount === 16) return '16-Channel (TOA)';
    return `${channelCount}-Channel`;
  };

  // ── Grouped-by-receiver structure ──────────────────────────────────────────
  const groupedByReceiver = useMemo((): {
    groups: ReceiverGroup[];
    unmapped: ImpulseResponseMetadata[];
  } | null => {
    const hasPairDefinitions = (pairDefinitions?.length ?? 0) > 0;
    if (!sourceReceiverIRMapping && !hasPairDefinitions) return null;

    const irById = new Map(impulseResponses.map(ir => [ir.id, ir]));
    const groups = new Map<string, ReceiverGroup>();
    const pairs: SourceReceiverPair[] = hasPairDefinitions
      ? pairDefinitions!
      : Object.entries(sourceReceiverIRMapping || {}).flatMap(([sourceId, receivers]) =>
          Object.keys(receivers).map((receiverId) => ({ sourceId, receiverId }))
        );

    for (const { sourceId, receiverId } of pairs) {
      const irMeta = sourceReceiverIRMapping?.[sourceId]?.[receiverId];
      const rg = receiverGroups?.[receiverId];
      const groupId = rg?.groupId ?? receiverId;
      const groupName = rg?.groupName ?? receiverDisplayNames?.[receiverId] ?? receiverId;

      if (!groups.has(groupId)) {
        groups.set(groupId, { groupId, groupName, sources: [] });
      }

      groups.get(groupId)!.sources.push({
        sourceId,
        receiverId,
        ir: irMeta ? irById.get(irMeta.id) ?? irMeta : null,
      });
    }

    const mappedIds = new Set(
      Object.values(sourceReceiverIRMapping || {}).flatMap(r => Object.values(r).map(ir => ir.id))
    );
    const unmapped = hasPairDefinitions ? [] : impulseResponses.filter(ir => !mappedIds.has(ir.id));

    return { groups: Array.from(groups.values()), unmapped };
  }, [sourceReceiverIRMapping, pairDefinitions, impulseResponses, receiverGroups, receiverDisplayNames]);

  // Safety net: also run the energy check and load buffers for IRs that appear in
  // the grouped view via the sourceReceiverIRMapping / irMeta fallback path — these
  // may not be present in `impulseResponses` when simulationIRIds filtering is active.
  useEffect(() => {
    if (!groupedByReceiver) return;
    for (const { sources } of groupedByReceiver.groups) {
      for (const { ir } of sources) {
        if (!ir) continue;
        // Metadata-based check first (instant, no download)
        const peak = (ir as any).peak_amplitude ?? ir.peakAmplitude;
        if (peak !== undefined && peak !== null && peak < IR_LOW_ENERGY_THRESHOLD) {
          setLowEnergyIRIds(prev => prev.has(ir.id) ? prev : new Set(prev).add(ir.id));
        }
        // Buffer load for hover preview / legacy fallback
        if (!bufferCache.has(ir.id)) loadIRBuffer(ir);
      }
    }
  }, [groupedByReceiver]);

  // ── Hover handlers shared between flat and grouped renders ─────────────────
  const handleRowMouseEnter = useCallback(async (
    e: React.MouseEvent<HTMLDivElement>,
    ir: ImpulseResponseMetadata,
    sourceId: string,
    receiverId: string,
  ) => {
    if (hideTimeoutRef.current) { clearTimeout(hideTimeoutRef.current); hideTimeoutRef.current = null; }
    setHoveredIRId(ir.id);
    if (IR_HOVER_LINE.ENABLED && onIRHover) onIRHover(sourceId, receiverId);
    const rect = e.currentTarget.getBoundingClientRect();
    const sidebar = document.querySelector('aside.fixed.right-0');
    const sidebarLeft = sidebar ? sidebar.getBoundingClientRect().left : rect.left;
    setOverlayPosition({ top: rect.top + rect.height / 2, left: sidebarLeft - 16, width: 0 });
    const buffer = await loadIRBuffer(ir);
    setHoveredIRBuffer(buffer);
  }, [onIRHover]);

  const handleRowMouseLeave = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => {
      if (!isOverlayHovered) {
        setHoveredIRId(null); setHoveredIRBuffer(null); setOverlayPosition(null);
        if (IR_HOVER_LINE.ENABLED && onIRHover) onIRHover(null, null);
      }
      hideTimeoutRef.current = null;
    }, 100);
  }, [isOverlayHovered, onIRHover]);

  const getSourceRowInfo = useCallback((
    sourceId: string,
    fallbackName?: string,
  ): { posLabel: string | null; soundCount: number; soundNames: string } => {
    const simPos = simulationSourcePositions?.[sourceId];
    // Label with the EXACT position values the backend embeds as `source_id` when
    // naming the generated IR file (sim_..._src_{sourceId}_rcv_...wav /
    // choras_..._src_{sourceId}_rcv_...wav) — sourceId IS that position key — rather
    // than the raw, un-quantized sound position, which can differ slightly.
    const keyPos = parsePositionKey(sourceId);
    const posLabel = keyPos
      ? `(${keyPos[0].toFixed(2)}, ${keyPos[1].toFixed(2)}, ${keyPos[2].toFixed(2)})`
      : null;

    let soundCount = 0;
    let soundNames = sourceDisplayNames?.[sourceId] ?? fallbackName ?? '';

    if (simPos && currentSoundPositions) {
      for (const pos of Object.values(currentSoundPositions)) {
        const dist = Math.hypot(simPos[0] - pos[0], simPos[1] - pos[1], simPos[2] - pos[2]);
        if (dist <= SIMULATION_POSITION_MATCH_THRESHOLD) {
          soundCount++;
        }
      }
    } else if (soundNames) {
      soundCount = soundNames.split(', ').filter(Boolean).length;
    }

    return { posLabel, soundCount, soundNames };
  }, [simulationSourcePositions, currentSoundPositions, sourceDisplayNames]);

  const countLabelStyle = simulationResults
    ? { color: 'var(--color-on-blue-muted)' }
    : undefined;
  const countLabelClass = simulationResults ? '' : 'text-secondary-hover';
  const rowTextClass = simulationResults ? '' : 'text-foreground';
  const rowTextStyle = simulationResults ? { color: 'var(--color-on-blue)' } : undefined;
  const rowMutedStyle = simulationResults ? { color: 'var(--color-on-blue-muted)' } : undefined;
  const rowMutedClass = simulationResults ? '' : 'text-secondary-hover';

  // ── Render helpers ──────────────────────────────────────────────────────────

  const renderSourceRow = (
    ir: ImpulseResponseMetadata,
    sourceId: string,
    receiverId: string,
    sourceName: string,
    options?: {
      fullName?: string;
    },
  ) => {
    const isLowEnergy = lowEnergyIRIds.has(ir.id);
    const { posLabel, soundCount, soundNames } = getSourceRowInfo(sourceId, options?.fullName ?? sourceName);
    const tooltipNames = options?.fullName ?? soundNames;
    const irBuffer = bufferCache.get(ir.id) ?? null;

    return (
      <div
        key={`${sourceId}-${receiverId}-${ir.id}`}
        className={`flex items-center gap-2 px-1 py-1.5 rounded transition-colors ${
          isLowEnergy ? 'border border-error/30' : ''
        }`}
        onMouseEnter={(e) => handleRowMouseEnter(e, ir, sourceId, receiverId)}
        onMouseLeave={handleRowMouseLeave}
      >
        <div className="flex-1 min-w-0 space-y-0.5">
          <div className={`text-[10px] truncate ${rowTextClass}`} style={rowTextStyle}>
            {posLabel ? (
              <span>{posLabel}</span>
            ) : (
              <span title={tooltipNames}>{sourceName}</span>
            )}
          </div>
          <div
            className={`text-[10px] truncate ${rowTextClass}`}
            style={rowTextStyle}
            title={tooltipNames || undefined}
          >
            <span className={rowMutedClass} style={rowMutedStyle}>Sounds in position: </span>
            <span className="font-medium tabular-nums">{soundCount}</span>
            {isLowEnergy && (
              <Badge variant="error" size="xs" className="ml-1.5">Low energy</Badge>
            )}
          </div>
        </div>
        <MiniIRWaveform
          audioBuffer={irBuffer}
          loading={bufferLoadingIds.has(ir.id)}
          onBlueBackground={!!simulationResults}
        />
      </div>
    );
  };

  const renderPairUploadRow = (
    sourceId: string,
    receiverId: string,
    sourceName: string,
    ir: ImpulseResponseMetadata | null,
    fullName?: string,
  ) => {
    const pairKey = buildPairKey(sourceId, receiverId);
    const isLowEnergy = ir ? lowEnergyIRIds.has(ir.id) : false;

    if (ir) {
      return renderSourceRow(
        ir,
        sourceId,
        receiverId,
        sourceName,
        { fullName },
      );
    }

    return (
      <div
        key={`${sourceId}-${receiverId}`}
        className={`rounded border px-2 py-2 ${
          isLowEnergy
            ? 'border-error/30 bg-error/10'
            : 'border-neutral-700/50'
        }`}
        style={isLowEnergy ? undefined : { backgroundColor: 'var(--color-blue-chip-bg)' }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-neutral-200 truncate" title={fullName ?? sourceName}>{sourceName}</div>
            <div className="text-[10px] text-neutral-500 mt-1">
              No IR imported yet. Auralization stays disabled for this pair.
            </div>
          </div>
        </div>

        <div className="mt-2">
          <FileUploadArea
            file={null}
            isDragging={draggingPairKey === pairKey}
            acceptedFormats=".wav,.flac,.aif,.aiff,.ogg"
            acceptedExtensions="wav, flac, aiff, ogg"
            onFileChange={handlePairFileChange(sourceId, receiverId)}
            onDragOver={handlePairDragOver(pairKey)}
            onDragLeave={handlePairDragLeave(pairKey)}
            onDrop={handlePairDrop(sourceId, receiverId, pairKey)}
            inputId={`pair-ir-${sourceId}-${receiverId}`}
          />
        </div>
      </div>
    );
  };

  // Single-IR-per-listener row: one upload slot for an entire receiver group,
  // applied to every source pair under that listener.
  const renderListenerUploadRow = (
    groupId: string,
    groupName: string,
    sources: Array<{ sourceId: string; receiverId: string; ir: ImpulseResponseMetadata | null }>,
  ) => {
    const pairs: SourceReceiverPair[] = sources.map(({ sourceId, receiverId }) => ({ sourceId, receiverId }));
    const assigned = sources.find((s) => s.ir)?.ir ?? null;
    const groupKey = `listener::${groupId}`;

    if (assigned) {
      return renderSourceRow(
        assigned,
        pairs[0]?.sourceId ?? '',
        pairs[0]?.receiverId ?? '',
        groupName,
      );
    }

    return (
      <div
        key={groupKey}
        className="rounded border px-2 py-2 border-neutral-700/50"
        style={{ backgroundColor: 'var(--color-blue-chip-bg)' }}
      >
        <div className="text-[10px] text-neutral-500 mb-2">
          One IR for this listener — applied to all {pairs.length} source pair{pairs.length === 1 ? '' : 's'}.
        </div>
        <FileUploadArea
          file={null}
          isDragging={draggingPairKey === groupKey}
          acceptedFormats=".wav,.flac,.aif,.aiff,.ogg"
          acceptedExtensions="wav, flac, aiff, ogg"
          onFileChange={handleListenerFileChange(pairs)}
          onDragOver={handlePairDragOver(groupKey)}
          onDragLeave={handlePairDragLeave(groupKey)}
          onDrop={handleListenerDrop(pairs, groupKey)}
          inputId={`listener-ir-${groupId}`}
        />
      </div>
    );
  };

  // Go-to icon (same concentric circles as EntityInfoPanel)
  const GoToIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );

  const hoveredIR = impulseResponses.find(ir => ir.id === hoveredIRId);
  const missingPairSetupMessage = (() => {
    if (!allowPairUploads) return null;
    const slotDescription = singleIRPerListener
      ? 'This card creates one IR upload slot for every listener, applied to all its source pairs.'
      : 'This card creates one IR upload slot for every source-listener pair.';
    if (availableSourceCount === 0 && availableReceiverCount === 0) {
      return `Add at least one sound source and one listener first. ${slotDescription}`;
    }
    if (availableSourceCount === 0) {
      return `Add at least one sound source first. ${slotDescription}`;
    }
    if (availableReceiverCount === 0) {
      return `Add at least one listener first. ${slotDescription}`;
    }
    return null;
  })();

  return (
    <div className="card-stack">
      {error && (
        <Notice type="error" message={error} />
      )}

      {uploadProgress && (
        <div className="text-xs rounded p-2 bg-neutral-100 dark:bg-neutral-900/40 border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300">
          {uploadProgress}
        </div>
      )}

      {/* First library load (no mapping rows to show yet) */}
      {isLoading && impulseResponses.length === 0 && !groupedByReceiver && !error && (
        <div className="flex items-center gap-2 text-xs text-secondary-hover">
          <Spinner size={12} />
          Loading impulse responses…
        </div>
      )}

      {missingPairSetupMessage && (
        <Notice type="info" message={missingPairSetupMessage} />
      )}

      {/* IR Library — grouped by receiver when mapping is available */}
      {(groupedByReceiver || impulseResponses.length > 0) && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3
              className={`text-xs font-semibold ${simulationResults ? '' : 'text-foreground'}`}
              style={simulationResults ? { color: 'var(--color-on-blue)' } : undefined}
            >
              {allowPairUploads
                ? (singleIRPerListener ? 'Listener IRs' : 'Source-listener IRs')
                : `Impulse Responses (${impulseResponses.length})`}
            </h3>
          </div>

          <div ref={scrollContainerRef} className="space-y-0.5 max-h-[min(320px,40dvh)] overflow-y-auto">
            {groupedByReceiver ? (
              <>
                {/* Receiver-grouped list */}
                {groupedByReceiver.groups.map(({ groupId, groupName, sources }) => {
                  const isCollapsed = collapsedGroups.has(groupId);
                  const hasLowEnergy = sources.some((s) => s.ir && lowEnergyIRIds.has(s.ir.id));
                  const isActive = activeGroupId === groupId;
                  return (
                    <div
                      key={groupId}
                      ref={(el) => setGroupRef(groupId, el)}
                      className="rounded transition-all duration-200"
                      style={{
                        border: `1px solid ${isActive ? 'var(--color-primary)' : 'transparent'}`,
                      }}
                    >
                      {/* Receiver header */}
                      <div className="flex items-center gap-1 px-1 py-1 group rounded">
                        <button
                          onClick={() => toggleGroup(groupId)}
                          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                        >
                          <ChevronRight
                            size={10}
                            className={`shrink-0 transition-transform duration-150 ${isCollapsed ? '' : 'rotate-90'} ${simulationResults ? '' : 'text-secondary-hover'}`}
                            style={simulationResults ? { color: 'var(--color-on-blue-muted)' } : undefined}
                          />
                          <span
                            className={`text-[11px] font-medium truncate ${simulationResults ? '' : 'text-foreground'}`}
                            style={simulationResults ? { color: 'var(--color-on-blue)' } : undefined}
                          >
                            {groupName}
                          </span>
                          {hasLowEnergy && (
                            <span className="text-[9px] text-error shrink-0 ml-0.5">!</span>
                          )}
                          <span className={`text-[9px] shrink-0 ${countLabelClass}`} style={countLabelStyle}>
                            ({sources.length})
                          </span>
                        </button>
                        {onGoToReceiver && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onGoToReceiver(groupId);
                            }}
                            className={`goto-listener-btn shrink-0 w-5 h-5 flex items-center justify-center rounded transition-all duration-200 ease-out${isActive ? ' goto-listener-btn--active' : ''}`}
                            style={{ color: 'var(--color-receiver)' }}
                            title="Go to Listener (first-person view)"
                          >
                            <GoToIcon />
                          </button>
                        )}
                      </div>

                      {/* Source rows */}
                      {!isCollapsed && (
                        <div className="ml-3 space-y-0.5 pb-1 pt-0.5">
                          {allowPairUploads && singleIRPerListener
                            ? renderListenerUploadRow(groupId, groupName, sources)
                            : sources.map(({ sourceId, receiverId, ir }) => {
                                const fullName = sourceDisplayNames?.[sourceId] ?? sourceId;
                                const sourceName = trimDisplayName(fullName);
                                if (allowPairUploads) {
                                  return renderPairUploadRow(sourceId, receiverId, sourceName, ir, fullName);
                                }
                                return ir
                                  ? renderSourceRow(ir, sourceId, receiverId, sourceName, { fullName })
                                  : null;
                              })}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Unmapped IRs (legacy / manual uploads) — flat */}
                {groupedByReceiver.unmapped.length > 0 && (
                  <div className="pt-1 space-y-1">
                    {groupedByReceiver.unmapped.map(ir => {
                      const pair = (() => {
                        if (!sourceReceiverIRMapping) return null;
                        for (const sourceId of Object.keys(sourceReceiverIRMapping)) {
                          for (const receiverId of Object.keys(sourceReceiverIRMapping[sourceId])) {
                            if (sourceReceiverIRMapping[sourceId][receiverId].id === ir.id)
                              return { sourceId, receiverId };
                          }
                        }
                        return null;
                      })();
                      return renderSourceRow(ir, pair?.sourceId ?? '', pair?.receiverId ?? '', ir.name);
                    })}
                  </div>
                )}
              </>
            ) : (
              /* Legacy flat list (no sourceReceiverIRMapping) */
              impulseResponses.map(ir => {
                const isLowEnergy = lowEnergyIRIds.has(ir.id);
                const irBuffer = bufferCache.get(ir.id) ?? null;
                return (
                  <div
                    key={ir.id}
                    className={`p-2 rounded transition-colors relative ${
                      isLowEnergy ? 'border border-error' : ''
                    }`}
                    onMouseEnter={async (e) => {
                      if (hideTimeoutRef.current) { clearTimeout(hideTimeoutRef.current); hideTimeoutRef.current = null; }
                      setHoveredIRId(ir.id);
                      if (IR_HOVER_LINE.ENABLED && onIRHover) onIRHover(null, null);
                      const rect = e.currentTarget.getBoundingClientRect();
                      const sidebar = document.querySelector('aside.fixed.right-0');
                      const sidebarLeft = sidebar ? sidebar.getBoundingClientRect().left : rect.left;
                      setOverlayPosition({ top: rect.top + rect.height / 2, left: sidebarLeft - 16, width: 0 });
                      const buffer = await loadIRBuffer(ir);
                      setHoveredIRBuffer(buffer);
                    }}
                    onMouseLeave={handleRowMouseLeave}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-medium truncate ${simulationResults ? '' : 'text-foreground'}`}
                          style={simulationResults ? { color: 'var(--color-on-blue)' } : undefined}
                        >
                          {ir.name}
                        </div>
                        <div className="flex items-center gap-2 mt-1 whitespace-nowrap">
                          {isLowEnergy && <Badge variant="error">Low energy</Badge>}
                          <span className={`text-xs flex-shrink-0 ${simulationResults ? '' : 'text-secondary-hover'}`}
                            style={simulationResults ? { color: 'var(--color-on-blue-muted)' } : undefined}
                          >
                            {ir.duration.toFixed(2)}s
                          </span>
                        </div>
                      </div>
                      <MiniIRWaveform
                        audioBuffer={irBuffer}
                        loading={bufferLoadingIds.has(ir.id)}
                        onBlueBackground={!!simulationResults}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Waveform Overlay */}
      {hoveredIRId && hoveredIRBuffer && overlayPosition && hoveredIR && (
        <div
          className="fixed z-[9999] w-fit max-w-[90vw] rounded-lg border overflow-hidden shadow-lg"
          style={{
            top: `${overlayPosition.top}px`,
            left: `${overlayPosition.left}px`,
            transform: 'translate(-100%, -50%)',
            borderColor: 'var(--color-border-strong)',
            backgroundColor: 'var(--color-surface)',
          }}
          onMouseEnter={() => setIsOverlayHovered(true)}
          onMouseLeave={() => {
            setIsOverlayHovered(false);
            setHoveredIRId(null); setHoveredIRBuffer(null); setOverlayPosition(null);
            if (IR_HOVER_LINE.ENABLED && onIRHover) onIRHover(null, null);
          }}
        >
          <AudioWaveformDisplay
            audioBuffer={hoveredIRBuffer}
            audioInfo={{
              filename: hoveredIR.name,
              sample_rate: hoveredIRBuffer.sampleRate,
              channels: formatChannelLabel(hoveredIRBuffer.numberOfChannels),
              duration: hoveredIRBuffer.duration,
              num_samples: hoveredIRBuffer.length,
            }}
            enableWaveform={true}
            hideTextInfo={false}
            onDownload={() => handleDownloadIR(hoveredIR)}
          />
        </div>
      )}

      {/* Help text — only outside simulation context */}
      {!simulationResults && (
        <div className="text-xs text-neutral-500">
          <strong>Supported formats:</strong> Mono (1-ch), Binaural (2-ch), FOA (4-ch), TOA (16-ch)
          <br />
          Multi-channel files (8-32ch) are auto-extracted to FOA or TOA.
        </div>
      )}
    </div>
  );
}
