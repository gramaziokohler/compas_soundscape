'use client';

import { createPortal } from 'react-dom';
import { UI_RIGHT_SIDEBAR } from '@/utils/constants';
import { getScale } from '@/utils/scale';

const PREVIEW_WIDTH = 160; // 50% of SceneContextMenu's INITIAL_WIDTH (320)
const VIEWPORT_MARGIN = 4;

interface HoverEntityInfo {
  objectName: string;
  objectType: string;
  parentName?: string;
}

interface SceneHoverPreviewProps {
  x: number;
  y: number;
  entity: HoverEntityInfo;
}

/**
 * SceneHoverPreview
 *
 * Lightweight tooltip-style panel shown after 2 s of hovering over a Speckle object.
 * 50% the size of SceneContextMenu, 80% opacity, pointer-events: none.
 * Rendered via createPortal to guarantee correct viewport-relative positioning.
 */
export function SceneHoverPreview({ x, y, entity }: SceneHoverPreviewProps) {
  if (typeof document === 'undefined') return null;

  const vp = getScale().viewport;

  // Clamp so the panel stays inside the viewport
  const left = Math.max(VIEWPORT_MARGIN, Math.min(x + 12, vp.width - PREVIEW_WIDTH - VIEWPORT_MARGIN));
  const top = Math.max(VIEWPORT_MARGIN, Math.min(y + 12, vp.height - VIEWPORT_MARGIN - 80));

  const title = entity.objectName || entity.objectType || 'Object';

  const panel = (
    <div
      style={{
        position: 'fixed',
        left,
        top,
        width: PREVIEW_WIDTH,
        zIndex: 999,
        opacity: 0.8,
        pointerEvents: 'none',
        backgroundColor: 'var(--background)',
        border: `${UI_RIGHT_SIDEBAR.BORDER_WIDTH}px solid var(--color-secondary-light)`,
        borderRadius: '6px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      <span
        style={{
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--foreground)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={title}
      >
        {title}
      </span>
      {(entity.parentName || (entity.objectType && entity.objectType !== entity.objectName)) && (
        <span
          style={{
            fontSize: '10px',
            color: 'var(--color-secondary-hover)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {entity.parentName || entity.objectType}
        </span>
      )}
      <span
        style={{
          fontSize: '10px',
          color: 'var(--color-primary)',
          marginTop: '2px',
          fontStyle: 'italic',
        }}
      >
        Right click to show details
      </span>
    </div>
  );

  return createPortal(panel, document.body);
}
