'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { toPng } from 'html-to-image';
import type { ModelAnalysisConfig } from '@/types/analysis';
import { useSpeckleStore, useAnalysisStore } from '@/store';
import { getRootNodesForModel } from '@/hooks/useSpeckleTree';
import { NUM_SOUNDS_MIN, NUM_SOUNDS_MAX } from '@/utils/constants';
import { RangeSlider } from '@/components/ui/RangeSlider';
import { useBatchedSlider } from '@/hooks/useBatchedSlider';

/**
 * Model3DContextContent Component
 * 
 * UI for 3D model analysis configuration (before generation)
 * Uses geometry_service.py backend
 */

interface Model3DContextContentProps {
  config: ModelAnalysisConfig;
  index: number;
  isAnalyzing: boolean;
  onUpdateConfig: (index: number, updates: Partial<ModelAnalysisConfig>) => void;
}

export function Model3DContextContent({
  config,
  index,
  isAnalyzing,
  onUpdateConfig
}: Model3DContextContentProps) {
  // Get viewer ref and selection state from store
  const { getViewerRef, diverseSelectedObjectIds, setDiverseSelection } = useSpeckleStore();

  // Batched slider — one undo step per drag gesture
  const numSoundsSlider = useBatchedSlider<number>('analysis', (v) =>
    onUpdateConfig(index, { numSounds: v }),
  );
  const viewerRef = useMemo<{ current: any }>(() => ({ get current() { return getViewerRef(); } }), [getViewerRef]);
  

  // World tree state (for entity population only)
  const [worldTree, setWorldTree] = useState<any>(null);
  const worldTreeRef = useRef<any>(null);
  const hasLoadedTreeRef = useRef<boolean>(false);

  // Track the source of diverse selection updates to prevent infinite loops
  // 'backend' = update came from backend API (should sync config → context)
  // 'context' = update came from manual user action (should sync context → config)
  // null = no pending sync
  const syncSourceRef = useRef<'backend' | 'context' | null>(null);

  // Track previous config entity count to detect backend updates
  const prevConfigEntityCountRef = useRef<number>(0);

  // Trigger tree fetch when viewer becomes available or speckleData changes
  useEffect(() => {
    if (!viewerRef?.current || !config.speckleData) return;

    const attemptTreeLoad = () => {
      if (!viewerRef.current) return false;

      const tree = viewerRef.current.getWorldTree();
      if (tree) {
        const rootNodes = getRootNodesForModel(tree);
        
        if (rootNodes && rootNodes.length > 0) {
          hasLoadedTreeRef.current = true;
          worldTreeRef.current = tree;
          setWorldTree(tree);
          return true;
        }
      }
      return false;
    };

    if (attemptTreeLoad()) return;

    const timeouts: NodeJS.Timeout[] = [];
    const delays = [500, 1000, 1500, 2000, 2500, 3000];
    
    delays.forEach(delay => {
      const timeout = setTimeout(() => {
        if (!hasLoadedTreeRef.current) {
          attemptTreeLoad();
        }
      }, delay);
      timeouts.push(timeout);
    });

    return () => {
      timeouts.forEach(timeout => clearTimeout(timeout));
    };
  }, [viewerRef?.current, config.speckleData]);
  
  // Detect backend updates to config.selectedDiverseEntities
  // This runs when the backend returns selected entities (count changes significantly)
  useEffect(() => {
    const currentCount = config.selectedDiverseEntities.length;
    const prevCount = prevConfigEntityCountRef.current;

    // Detect if this is a backend update (count changed and we have entities)
    // Backend updates typically set a specific number of entities all at once
    if (currentCount > 0 && currentCount !== prevCount) {
      // Extract nodeIds from config.selectedDiverseEntities
      const configNodeIds = config.selectedDiverseEntities
        .map(entity => entity.nodeId || entity.id)
        .filter(Boolean);

      // Get current context IDs for comparison
      const contextIds = Array.from(diverseSelectedObjectIds);

      // Only sync if this looks like a backend update (not a context-driven update)
      // Backend updates: config has entities that context doesn't know about
      const configHasNewEntities = configNodeIds.some(id => !contextIds.includes(id));

      if (configHasNewEntities) {
        console.log('[Model3DContextContent] Backend update detected, syncing config -> context:', {
          configCount: configNodeIds.length,
          contextCount: contextIds.length
        });
        syncSourceRef.current = 'backend';
        setDiverseSelection(configNodeIds);
      }
    }

    prevConfigEntityCountRef.current = currentCount;
  }, [config.selectedDiverseEntities, diverseSelectedObjectIds, setDiverseSelection]);

  // Sync FROM context TO config (for manual selections via EntityInfoPanel)
  // This handles when user manually adds/removes entities from diverse selection
  useEffect(() => {
    // Skip if this update came from a backend sync (prevents infinite loop)
    if (syncSourceRef.current === 'backend') {
      syncSourceRef.current = null;
      return;
    }

    const diverseIds = Array.from(diverseSelectedObjectIds);
    const diverseEntities = config.modelEntities.filter(entity =>
      diverseIds.includes(entity.nodeId || entity.id)
    );

    // Compare IDs to check if update is needed
    const currentIds = config.selectedDiverseEntities.map(e => e.nodeId || e.id).sort();
    const newIds = diverseEntities.map(e => e.nodeId || e.id).sort();

    const isDifferent = currentIds.length !== newIds.length ||
      !currentIds.every((id, i) => id === newIds[i]);

    if (isDifferent) {
      console.log('[Model3DContextContent] Manual selection, syncing context -> config:', {
        contextCount: diverseIds.length,
        configCount: currentIds.length,
        newConfigCount: newIds.length
      });
      onUpdateConfig(index, { selectedDiverseEntities: diverseEntities });
    }
  }, [diverseSelectedObjectIds, config.modelEntities, config.selectedDiverseEntities, index, onUpdateConfig]);

  // Auto-populate entities from worldTree (recursively traverse children)
  useEffect(() => {
    // Only populate if we have worldTree and speckleData
    if (!worldTree || !config.speckleData) {
      return;
    }
    
    // Debounce: Wait 500ms for tree to stabilize
    const timeout = setTimeout(() => {
      
      // Extract entities by recursively walking the tree
      const entities: any[] = [];
      let entityIndex = 0;
      
      const processNode = (node: any) => {
        if (!node) return;
        
        const hasRenderView = node.model?.renderView || node.renderView;
        const raw = node.raw || node.model?.raw || {};
        const id = raw.id || node.model?.id || node.id || `node-${entityIndex}`;
        const speckleType = raw.speckle_type || raw.speckle?.type || 'Object';
        const name = raw.name || node.model?.name || speckleType.split('.').pop() || 'Object';
        
        // Include nodes that have a render view or speckle_type
        if (hasRenderView || raw.speckle_type) {
          entities.push({
            id,
            index: entityIndex++,
            type: speckleType,
            name,
            speckle_type: speckleType,
            raw,
            nodeId: id,
          });
        }
        
        // Recursively process children
        const nodeChildren = node.model?.children || node.children;
        if (nodeChildren && Array.isArray(nodeChildren)) {
          nodeChildren.forEach(processNode);
        }
      };
      
      // Start from root children using the helper function
      const rootNodes = getRootNodesForModel(worldTree);
      
      if (rootNodes && Array.isArray(rootNodes)) {
        rootNodes.forEach(processNode);
      }
      
      if (entities.length > 0 && entities.length !== config.modelEntities.length) {
        // Auto-populate is not a user action — pause temporal so it doesn't create
        // a separate undo entry from the card-creation step.
        useAnalysisStore.temporal.getState().pause();
        onUpdateConfig(index, { modelEntities: entities });
        useAnalysisStore.temporal.getState().resume();
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [worldTree, config.speckleData, config.modelEntities.length, index, onUpdateConfig]);

  // Model is loaded if we have a file OR speckleData (new Speckle workflow)
  const hasModelLoaded = config.modelFile !== null || config.speckleData !== undefined;
  const hasSelectedEntities = config.selectedDiverseEntities.length > 0;

  return (
    <div className="space-y-3">
      {/* Model not loaded message */}
      {!hasModelLoaded && (
        <div
          className="rounded p-3 text-xs text-center"
          style={{
            backgroundColor: 'var(--color-secondary-lighter)',
            color: 'var(--color-secondary-hover)',
          }}
        >
          No model loaded. Import a 3D model from the right sidebar.
        </div>
      )}

      {/* Model loaded UI */}
      {hasModelLoaded && (
        <div className="space-y-3">
          {/* Model info */}
            <div className="mx-4 text-xs text-secondary-hover">
              {!(config.selectedDiverseEntities.length > 0)
                // ? `${config.modelEntities.length} objects`
                ? 'Select diverse objects from the model or auto-select below.' 
                : ''}
            </div>

          {/* Number of sounds */}
          <RangeSlider
            label="Number of sounds: "
            value={config.numSounds ?? NUM_SOUNDS_MIN}
            min={NUM_SOUNDS_MIN}
            max={NUM_SOUNDS_MAX}
            step={1}
            onDragStart={numSoundsSlider.onDragStart}
            onChange={numSoundsSlider.onChange}
            onChangeCommitted={numSoundsSlider.onCommit}
          />

          {/* Capture View button + thumbnails */}
          <CaptureViewSection
            index={index}
            screenshots={config.liveScreenshots ?? []}
            onUpdateConfig={onUpdateConfig}
          />

          {/* Note: Action button is rendered by Card component */}
        </div>
      )}
    </div>
  );
}

// ─── CaptureViewSection ───────────────────────────────────────────────────────

interface CaptureViewSectionProps {
  index: number;
  screenshots: string[];
  onUpdateConfig: (index: number, updates: Partial<import('@/types/analysis').ModelAnalysisConfig>) => void;
}

function CaptureViewSection({ index, screenshots, onUpdateConfig }: CaptureViewSectionProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCapture = useCallback(async () => {
    const container = document.getElementById('speckle-scene-container');
    if (!container) {
      setError('Viewer not found');
      return;
    }

    setIsCapturing(true);
    setError(null);

    try {
      const dataUrl = await toPng(container, { cacheBust: true });

      const res = await fetch('/api/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const { image } = await res.json() as { image: string };
      onUpdateConfig(index, { liveScreenshots: [...screenshots, image] });
    } catch (err) {
      console.error('[CaptureViewSection] Capture failed:', err);
      setError(err instanceof Error ? err.message : 'Capture failed');
    } finally {
      setIsCapturing(false);
    }
  }, [index, screenshots, onUpdateConfig]);

  const handleRemove = useCallback((i: number) => {
    onUpdateConfig(index, { liveScreenshots: screenshots.filter((_, idx) => idx !== i) });
  }, [index, screenshots, onUpdateConfig]);

  return (
    <div className="px-4 space-y-2">
      {/* Capture button */}
      <button
        onClick={handleCapture}
        disabled={isCapturing}
        className="w-full text-xs py-1.5 px-3 rounded flex items-center justify-center gap-1.5"
        style={{
          backgroundColor: 'var(--color-secondary-lighter)',
          color: screenshots.length > 0 ? 'var(--color-success, #4ade80)' : 'var(--color-secondary-hover)',
          opacity: isCapturing ? 0.6 : 1,
          cursor: isCapturing ? 'wait' : 'pointer',
        }}
      >
        {isCapturing
          ? 'Capturing…'
          : screenshots.length > 0
            ? `+ Capture view (${screenshots.length} captured)`
            : 'Capture current view'}
      </button>

      {/* Thumbnail strip */}
      {screenshots.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {screenshots.map((src, i) => (
            <Thumbnail key={i} src={src} onRemove={() => handleRemove(i)} />
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs" style={{ color: 'var(--color-error, #f87171)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Thumbnail ────────────────────────────────────────────────────────────────

function Thumbnail({ src, onRemove }: { src: string; onRemove: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative rounded overflow-hidden flex-shrink-0"
      style={{ width: 52, height: 52 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <img src={src} alt="capture" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      {hovered && (
        <button
          onClick={onRemove}
          className="absolute top-0 right-0 flex items-center justify-center rounded-bl"
          style={{
            width: 16,
            height: 16,
            fontSize: 10,
            lineHeight: 1,
            backgroundColor: 'rgba(0,0,0,0.7)',
            color: '#fff',
            cursor: 'pointer',
            border: 'none',
            padding: 0,
          }}
          title="Remove"
        >
          ×
        </button>
      )}
    </div>
  );
}
