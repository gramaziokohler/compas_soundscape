"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { AudioWaveformDisplay } from "@/components/audio/AudioWaveformDisplay";
import { FileUploadArea } from "@/components/controls/FileUploadArea";
import { apiService } from "@/services/api";
import { useApiErrorHandler } from "@/hooks/useApiErrorHandler";
import type { ImpulseResponseMetadata, SourceReceiverIRMapping } from "@/types/audio";
import { API_BASE_URL, IR_HOVER_LINE, IR_LOW_ENERGY_THRESHOLD } from "@/utils/constants";
import { trimDisplayName } from "@/utils/utils";

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
}: ImpulseResponseUploadProps) {
  const handleError = useApiErrorHandler();
  const [impulseResponses, setImpulseResponses] = useState<ImpulseResponseMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string>('');

  const [bufferCache, setBufferCache] = useState<Map<string, AudioBuffer>>(new Map());
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
    if (!forcedActiveGroupId) return;
    setActiveGroupId(forcedActiveGroupId);
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

  const loadIRBuffer = async (ir: ImpulseResponseMetadata): Promise<AudioBuffer | null> => {
    const cached = bufferCache.get(ir.id);
    if (cached) return cached;
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
    }
  };

  const handleDeleteIR = async (irId: string, irName: string) => {
    try {
      setError(null);
      await apiService.deleteImpulseResponse(irId);
      await loadImpulseResponses();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete IR';
      setError(errorMessage);
      handleError(err, errorMessage);
    }
  };

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

  const getFormatBadge = (format: string) => {
    const badges = {
      mono:     { color: 'bg-info-light text-info',         label: 'Mono' },
      binaural: { color: 'bg-primary-light text-primary',   label: 'Binaural' },
      foa:      { color: 'bg-success-light text-success',   label: 'FOA' },
      toa:      { color: 'bg-warning-light text-warning',   label: 'TOA' },
    };
    return badges[format as keyof typeof badges] || { color: 'bg-neutral-100 text-neutral-800', label: format };
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
    setOverlayPosition({ top: rect.top + rect.height / 2, left: rect.right + 16, width: 0 });
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

  // ── Render helpers ──────────────────────────────────────────────────────────

  const renderSourceRow = (
    ir: ImpulseResponseMetadata,
    sourceId: string,
    receiverId: string,
    sourceName: string,
    options?: {
      onDelete?: (e: React.MouseEvent<HTMLButtonElement>) => void;
      deleteTitle?: string;
    },
  ) => {
    const badge = getFormatBadge(ir.format);
    const isLowEnergy = lowEnergyIRIds.has(ir.id);
    return (
      <div
        key={`${sourceId}-${receiverId}-${ir.id}`}
        className={`flex items-center gap-2 px-2 py-1.5 rounded border transition-colors ${
          isLowEnergy
            ? 'border-error/30 bg-error/10'
            : 'border-neutral-700/50 hover:border-neutral-600/70'
        }`}
        onMouseEnter={(e) => handleRowMouseEnter(e, ir, sourceId, receiverId)}
        onMouseLeave={handleRowMouseLeave}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-neutral-200 truncate">{sourceName}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`text-[9px] px-1.5 py-0.5 rounded ${badge.color}`}>{badge.label}</span>
            {isLowEnergy && <span className="text-[9px] font-medium text-error">Low energy</span>}
            <span className="text-[9px] text-neutral-500">{ir.duration.toFixed(2)}s</span>
          </div>
        </div>
        <button
          onClick={options?.onDelete ?? ((e) => { e.stopPropagation(); handleDeleteIR(ir.id, ir.name); })}
          className="shrink-0 text-neutral-500 hover:text-error transition-colors"
          title={options?.deleteTitle ?? 'Delete IR'}
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    );
  };

  const renderPairUploadRow = (
    sourceId: string,
    receiverId: string,
    sourceName: string,
    ir: ImpulseResponseMetadata | null,
  ) => {
    const pairKey = buildPairKey(sourceId, receiverId);
    const isLowEnergy = ir ? lowEnergyIRIds.has(ir.id) : false;
    const fileSize = ir ? ((ir as any).fileSize ?? (ir as any).file_size ?? 0) : 0;

    if (ir) {
      return renderSourceRow(
        ir,
        sourceId,
        receiverId,
        sourceName,
        onPairAssignmentCleared
          ? {
              onDelete: (e) => {
                e.stopPropagation();
                onPairAssignmentCleared(sourceId, receiverId);
              },
              deleteTitle: 'Clear assigned IR',
            }
          : undefined,
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
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-neutral-200 truncate">{sourceName}</div>
            <div className="text-[10px] text-neutral-500 mt-1">
              No IR imported yet. Auralization stays disabled for this pair.
            </div>
          </div>
        </div>

        <div className="mt-2">
          <FileUploadArea
            file={ir ? { name: ir.name, size: fileSize } : null}
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
    if (availableSourceCount === 0 && availableReceiverCount === 0) {
      return 'Add at least one sound source and one listener first. This card creates one IR upload slot for every source-listener pair.';
    }
    if (availableSourceCount === 0) {
      return 'Add at least one sound source first. This card creates one IR upload slot for every source-listener pair.';
    }
    if (availableReceiverCount === 0) {
      return 'Add at least one listener first. This card creates one IR upload slot for every source-listener pair.';
    }
    return null;
  })();

  return (
    <div className="flex flex-col gap-4">
      {/* Error Display */}
      {error && (
        <div className="text-xs rounded p-2 bg-error/10 border border-error text-error">
          {error}
        </div>
      )}

      {uploadProgress && (
        <div className="text-xs rounded p-2 bg-neutral-100 dark:bg-neutral-900/40 border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300">
          {uploadProgress}
        </div>
      )}

      {missingPairSetupMessage && (
        <div className="text-xs rounded p-3 bg-info/10 border border-info/40 text-info">
          {missingPairSetupMessage}
        </div>
      )}

      {/* IR Library — grouped by receiver when mapping is available */}
      {(groupedByReceiver || impulseResponses.length > 0) && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className={`text-xs font-semibold ${simulationResults ? 'text-white' : ''}`}>
              {allowPairUploads ? 'Source-listener IRs' : `Impulse Responses (${impulseResponses.length})`}
            </h3>
          </div>

          <div ref={scrollContainerRef} className="space-y-0.5 max-h-80 overflow-y-auto">
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
                      style={{ border: `1px solid ${isActive ? 'var(--color-primary)' : 'transparent'}` }}
                    >
                      {/* Receiver header */}
                      <div className="flex items-center gap-1 px-1 py-1 group rounded hover:bg-neutral-800/40">
                        <button
                          onClick={() => toggleGroup(groupId)}
                          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
                        >
                          <ChevronRight
                            size={10}
                            className={`shrink-0 text-neutral-500 transition-transform duration-150 ${isCollapsed ? '' : 'rotate-90'}`}
                          />
                          <span className="text-[11px] font-medium text-neutral-200 truncate">{groupName}</span>
                          {hasLowEnergy && (
                            <span className="text-[9px] text-error shrink-0 ml-0.5">!</span>
                          )}
                          <span className="text-[9px] text-neutral-600 shrink-0">({sources.length})</span>
                        </button>
                        {onGoToReceiver && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveGroupId(groupId);
                              onGoToReceiver(groupId);
                            }}
                            className="shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors opacity-0 group-hover:opacity-100 hover:text-white"
                            style={{ color: isActive ? 'var(--color-primary)' : 'rgb(163 163 163)' }}
                            title="Go to Listener (first-person view)"
                          >
                            <GoToIcon />
                          </button>
                        )}
                      </div>

                      {/* Source rows */}
                      {!isCollapsed && (
                        <div className="ml-4 pl-2 border-l border-neutral-700/50 space-y-1 pb-1 pt-0.5">
                          {sources.map(({ sourceId, receiverId, ir }) => {
                            const sourceName = trimDisplayName(sourceDisplayNames?.[sourceId] ?? sourceId);
                            if (allowPairUploads) {
                              return renderPairUploadRow(sourceId, receiverId, sourceName, ir);
                            }
                            return ir
                              ? renderSourceRow(ir, sourceId, receiverId, sourceName)
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
                const badge = getFormatBadge(ir.format);
                const isLowEnergy = lowEnergyIRIds.has(ir.id);
                return (
                  <div
                    key={ir.id}
                    className={`p-3 rounded-lg transition-colors relative border ${
                      isLowEnergy
                        ? 'border-error'
                        : simulationResults
                          ? 'border-neutral-700 hover:border-neutral-600'
                          : 'border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600'
                    }`}
                    onMouseEnter={async (e) => {
                      if (hideTimeoutRef.current) { clearTimeout(hideTimeoutRef.current); hideTimeoutRef.current = null; }
                      setHoveredIRId(ir.id);
                      if (IR_HOVER_LINE.ENABLED && onIRHover) onIRHover(null, null);
                      const rect = e.currentTarget.getBoundingClientRect();
                      setOverlayPosition({ top: rect.top + rect.height / 2, left: rect.right + 16, width: 0 });
                      const buffer = await loadIRBuffer(ir);
                      setHoveredIRBuffer(buffer);
                    }}
                    onMouseLeave={handleRowMouseLeave}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-medium truncate ${simulationResults ? 'text-white' : ''}`}>
                          {ir.name}
                        </div>
                        <div className="flex items-center gap-2 mt-1 whitespace-nowrap">
                          <span className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ${badge.color}`}>{badge.label}</span>
                          {isLowEnergy && <span className="text-xs font-medium text-error flex-shrink-0">Low energy</span>}
                          <span className={`text-xs flex-shrink-0 ${simulationResults ? 'text-neutral-400' : 'text-neutral-600 dark:text-neutral-400'}`}>
                            Length={ir.duration.toFixed(2)}s
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteIR(ir.id, ir.name); }}
                        className="text-neutral-400 hover:text-error transition-colors"
                        title="Delete IR"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
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
          className="fixed shadow-2xl -translate-y-1/2 z-[9999] w-fit max-w-[90vw]"
          style={{ top: `${overlayPosition.top}px`, left: `${overlayPosition.left}px` }}
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
            hideTextInfo={true}
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
