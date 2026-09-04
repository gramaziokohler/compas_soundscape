'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { toPng } from 'html-to-image';
import type { AnalyzeModelConfig } from '@/types/analysis';
import { useSpeckleStore, useAnalysisStore, useUIStore } from '@/store';
import { getRootNodesForModel } from '@/hooks/useSpeckleTree';
import { DashedAddButton } from '@/components/ui/DashedAddButton';

/**
 * AnalyzeModelContent
 *
 * Configuration UI for the 'model-analysis' card type (before analysis runs).
 * Lets the user capture screenshots and provide optional text context.
 */

interface AnalyzeModelContentProps {
  config: AnalyzeModelConfig;
  index: number;
  isAnalyzing: boolean;
  onUpdateConfig: (index: number, updates: Partial<AnalyzeModelConfig>) => void;
}

export function AnalyzeModelContent({
  config,
  index,
  isAnalyzing,
  onUpdateConfig,
}: AnalyzeModelContentProps) {
  const { getViewerRef } = useSpeckleStore();
  const viewerRef = useMemo<{ current: any }>(
    () => ({ get current() { return getViewerRef(); } }),
    [getViewerRef],
  );

  // World tree loading — populates modelEntities
  const hasLoadedTreeRef = useRef(false);
  const [entityCount, setEntityCount] = useState(config.modelEntities.length);

  useEffect(() => {
    if (!viewerRef?.current || !config.speckleData) return;

    const attemptLoad = () => {
      if (!viewerRef.current) return false;
      const tree = viewerRef.current.getWorldTree();
      if (!tree) return false;
      const rootNodes = getRootNodesForModel(tree);
      if (!rootNodes || rootNodes.length === 0) return false;

      hasLoadedTreeRef.current = true;

      const entities: any[] = [];
      let idx = 0;

      // Layer names whose entire subtree must be excluded from the entity list
      const _EXCLUDED_MODEL_LAYERS = new Set(['acoustics', 'soundscape']);

      const processNode = (node: any, excludeSubtree = false, parentLayer = '') => {
        if (!node) return;
        const hasRV = node.model?.renderView || node.renderView;
        const raw = node.raw || node.model?.raw || {};
        const id = raw.id || node.model?.id || node.id || `node-${idx}`;
        const speckleType = raw.speckle_type || raw.speckle?.type || 'Object';
        const name = raw.name || node.model?.name || speckleType.split('.').pop() || 'Object';

        // Skip this node and its entire subtree if it belongs to an excluded layer
        const isExcluded = excludeSubtree || _EXCLUDED_MODEL_LAYERS.has(name.toLowerCase().trim());

        // Collection/Layer nodes set the layer context for their children
        const isContainer = speckleType.includes('Collection') || speckleType.includes('Layer');
        const currentLayer = isContainer && name !== 'Object' ? name : parentLayer;

        if (!isExcluded && (hasRV || raw.speckle_type)) {
          // Extract bounding box from the viewer's render view (raw.bbox is an
          // unresolved Speckle reference and is always null at this stage)
          const aabb = (node.model?.renderView || node.renderView)?.aabb;
          const bbox = aabb
            ? { min: { x: aabb.min.x, y: aabb.min.y, z: aabb.min.z },
                max: { x: aabb.max.x, y: aabb.max.y, z: aabb.max.z } }
            : null;
          entities.push({
            id, index: idx++, type: speckleType, name, speckle_type: speckleType,
            layer: raw.layer || (isContainer ? '' : currentLayer),
            raw, nodeId: id, bbox,
          });
        }
        const children = node.model?.children || node.children;
        if (children && Array.isArray(children)) {
          children.forEach((child: any) => processNode(child, isExcluded, currentLayer));
        }
      };

      rootNodes.forEach((node: any) => processNode(node));

      if (entities.length > 0 && entities.length !== config.modelEntities.length) {
        useAnalysisStore.temporal.getState().pause();
        onUpdateConfig(index, { modelEntities: entities });
        useAnalysisStore.temporal.getState().resume();
        setEntityCount(entities.length);
      } else if (config.modelEntities.length > 0) {
        setEntityCount(config.modelEntities.length);
      }

      return true;
    };

    if (attemptLoad()) return;

    const timeouts: NodeJS.Timeout[] = [];
    [500, 1000, 1500, 2000, 2500, 3000].forEach((delay) => {
      timeouts.push(setTimeout(() => { if (!hasLoadedTreeRef.current) attemptLoad(); }, delay));
    });
    return () => timeouts.forEach(clearTimeout);
  }, [viewerRef?.current, config.speckleData]);

  // Keep entityCount in sync when config changes externally
  useEffect(() => {
    setEntityCount(config.modelEntities.length);
  }, [config.modelEntities.length]);

  const hasModel = config.speckleData !== undefined || config.modelEntities.length > 0;

  return (
    <div className="card-stack">
      {!hasModel && (
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

      {hasModel && (

        <div className="card-stack">

          {/* Entity count */}
          <div className="text-xxs" style={{ color: 'var(--color-text-3)' }}>
            {entityCount > 0
              ? `${entityCount} object${entityCount !== 1 ? 's' : ''} detected`
              : 'Loading model objects…'}
          </div>


          {/* Optional user context */}
          <div className="card-field">
            <label className="text-xxs font-medium" style={{ color: 'var(--color-secondary-hover)' }}>
              Context (optional)
            </label>
            <textarea
              rows={2}
              placeholder="Describe the space, use case, or any context to guide analysis…"
              value={config.userContext}
              onChange={(e) => onUpdateConfig(index, { userContext: e.target.value })}
              disabled={isAnalyzing}
              className="w-full text-xs rounded px-2 py-1.5 resize-none"
              style={{
                backgroundColor: 'var(--color-secondary-lighter)',
                color: 'var(--color-foreground)',
                border: '1px solid var(--color-secondary-light)',
                outline: 'none',
              }}
            />
          </div>

          {/* Capture view section */}
          <CaptureViewSection
            index={index}
            screenshots={config.liveScreenshots}
            screenshotFilenames={config.liveScreenshotFilenames ?? []}
            onUpdateConfig={onUpdateConfig}
          />

        </div>
      )}
    </div>
  );
}

// ─── CaptureViewSection ───────────────────────────────────────────────────────

interface CaptureViewSectionProps {
  index: number;
  screenshots: string[];
  screenshotFilenames: string[];
  onUpdateConfig: (index: number, updates: Partial<AnalyzeModelConfig>) => void;
}

function CaptureViewSection({ index, screenshots, screenshotFilenames, onUpdateConfig }: CaptureViewSectionProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCapture = useCallback(async () => {
    const container = document.getElementById('speckle-scene-container');
    if (!container) { setError('Viewer not found'); return; }
    setIsCapturing(true);
    setError(null);
    const { showGroundGrid, setShowGroundGrid } = useUIStore.getState();
    const wasShowingGrid = showGroundGrid;
    try {
      if (!wasShowingGrid) {
        setShowGroundGrid(true);
        await new Promise<void>((resolve) => setTimeout(resolve, 300));
      }
      const dataUrl = await toPng(container, { cacheBust: true });
      const res = await fetch('/api/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const { image, filename } = (await res.json()) as { image: string; filename: string };
      onUpdateConfig(index, {
        liveScreenshots: [...screenshots, image],
        liveScreenshotFilenames: [...screenshotFilenames, filename],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture failed');
    } finally {
      if (!wasShowingGrid) {
        setShowGroundGrid(false);
      }
      setIsCapturing(false);
    }
  }, [index, screenshots, screenshotFilenames, onUpdateConfig]);

  const handleRemove = useCallback(
    (i: number) => {
      const filename = screenshotFilenames[i];
      if (filename) {
        fetch(`/api/screenshot?filename=${encodeURIComponent(filename)}`, { method: 'DELETE' }).catch(() => {});
      }
      onUpdateConfig(index, {
        liveScreenshots: screenshots.filter((_, idx) => idx !== i),
        liveScreenshotFilenames: screenshotFilenames.filter((_, idx) => idx !== i),
      });
    },
    [index, screenshots, screenshotFilenames, onUpdateConfig],
  );

  return (
    <div className="card-field">
      <label className="text-xxs font-medium" style={{ color: 'var(--color-secondary-hover)' }}>
        Screenshots (optional)
      </label>
      <div className="flex flex-wrap gap-1.5">
        {screenshots.map((src, i) => (
          <Thumbnail key={i} src={src} onRemove={() => handleRemove(i)} />
        ))}
        <DashedAddButton
          onClick={handleCapture}
          disabled={isCapturing}
          className="flex-shrink-0 self-center"
          icon={isCapturing ? '…' : '+'}
          style={{
            cursor: isCapturing ? 'wait' : 'pointer',
            opacity: isCapturing ? 0.6 : 1,
          }}
          title="Capture current view"
        />
      </div>
      {error && (
        <p className="text-xs" style={{ color: 'var(--color-error, #f87171)' }}>{error}</p>
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
            width: 16, height: 16, fontSize: 10, lineHeight: 1,
            backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff',
            cursor: 'pointer', border: 'none', padding: 0,
          }}
          title="Remove"
        >×</button>
      )}
    </div>
  );
}
