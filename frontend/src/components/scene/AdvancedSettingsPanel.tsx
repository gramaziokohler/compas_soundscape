'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { AdvancedSettingsSection } from '@/components/layout/sidebar/AdvancedSettingsSection';
import type { AdvancedSettingsSectionProps } from '@/components/layout/sidebar/AdvancedSettingsSection';

const MIN_WIDTH = 300;
const PANEL_MARGIN = 12;

interface AdvancedSettingsPanelProps extends AdvancedSettingsSectionProps {
  isVisible: boolean;
  onClose: () => void;
}

export function AdvancedSettingsPanel({ isVisible, onClose, ...settingsProps }: AdvancedSettingsPanelProps) {
  // SSR-safe: start offscreen, correct after mount
  const [position, setPosition] = useState({ x: -9999, y: -9999 });
  const [width, setWidth] = useState(MIN_WIDTH);
  const [positionReady, setPositionReady] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    const naturalWidth = el ? Math.max(MIN_WIDTH, el.scrollWidth + 24) : MIN_WIDTH;
    setWidth(naturalWidth);
    setPosition({
      x: Math.max(PANEL_MARGIN, window.innerWidth / 2 - naturalWidth / 2),
      y: Math.max(PANEL_MARGIN, window.innerHeight / 4),
    });
    setPositionReady(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, panelX: 0, panelY: 0 });

  const positionRef = useRef(position);
  useEffect(() => { positionRef.current = position; }, [position]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        const dx = e.clientX - dragStartRef.current.mouseX;
        const dy = e.clientY - dragStartRef.current.mouseY;
        setPosition({
          x: dragStartRef.current.panelX + dx,
          y: dragStartRef.current.panelY + dy,
        });
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return;
    isDraggingRef.current = true;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      panelX: positionRef.current.x,
      panelY: positionRef.current.y,
    };
    e.preventDefault();
  }, []);

  return (
    <div
      className="fixed flex flex-col backdrop-blur-sm shadow-2xl"
      style={{
        left: position.x,
        top: position.y,
        width: width,
        zIndex: 9999,
        display: (isVisible && positionReady) ? 'flex' : 'none',
        backgroundColor: 'var(--background)',
        border: '1px solid var(--color-secondary-light)',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      {/* Header — drag handle */}
      <div
        className="flex items-center justify-between px-3 flex-shrink-0"
        style={{
          height: '40px',
          borderBottom: '1px solid var(--color-secondary-light)',
          cursor: 'grab',
          userSelect: 'none',
          backgroundColor: 'var(--background)',
        }}
        onMouseDown={handleDragStart}
      >
        <span className="text-sm font-semibold text-foreground">Settings</span>
        <button
          data-no-drag
          onClick={onClose}
          className="flex items-center justify-center rounded transition-colors"
          style={{
            width: '24px',
            height: '24px',
            color: 'var(--color-secondary-hover)',
            backgroundColor: 'transparent',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-secondary-light)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          title="Close"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div ref={contentRef} style={{ padding: '12px' }}>
        <AdvancedSettingsSection {...settingsProps} />
      </div>
    </div>
  );
}
