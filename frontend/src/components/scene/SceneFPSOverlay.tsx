'use client';

import React from 'react';
import { UI_RIGHT_SIDEBAR, UI_VERTICAL_TABS } from '@/utils/constants';

// Left sidebar content width when expanded (matches Sidebar.tsx: 20rem = 320px)
const LEFT_SIDEBAR_CONTENT_WIDTH = 320;
// Right sidebar collapsed width
const RIGHT_SIDEBAR_COLLAPSED_WIDTH = 40;

interface SceneFPSOverlayProps {
  isFirstPersonMode: boolean;
  isLeftSidebarExpanded: boolean;
  isRightSidebarExpanded: boolean;
  leftSidebarContentWidth?: number;
  rightSidebarWidth?: number;
}

export function SceneFPSOverlay({
  isFirstPersonMode,
  isLeftSidebarExpanded,
  isRightSidebarExpanded,
  leftSidebarContentWidth,
  rightSidebarWidth,
}: SceneFPSOverlayProps) {
  if (!isFirstPersonMode) return null;

  const effectiveLeftContent = leftSidebarContentWidth ?? LEFT_SIDEBAR_CONTENT_WIDTH;
  const effectiveRightWidth = rightSidebarWidth ?? UI_RIGHT_SIDEBAR.WIDTH;
  const leftW = UI_VERTICAL_TABS.WIDTH + (isLeftSidebarExpanded ? effectiveLeftContent : 0);
  const rightW = isRightSidebarExpanded ? effectiveRightWidth : RIGHT_SIDEBAR_COLLAPSED_WIDTH;
  const centerOffset = (leftW - rightW) / 2;

  return (
    <div
      className="absolute top-4 pointer-events-none z-20 flex flex-col items-center gap-1 transition-all duration-300"
      style={{
        left: `calc(50% + ${centerOffset}px)`,
        transform: 'translateX(-50%)',
      }}
    >
      <div
        className="px-4 py-2 rounded-xl text-xs font-medium text-white text-center"
        style={{
          backgroundColor: 'rgba(0,0,0,0.55)',
          border: '1px solid rgba(255,255,255,0.15)',
          backdropFilter: 'blur(6px)',
        }}
      >
        <span className="opacity-90">First-person view · Use</span>{' '}
        <kbd className="px-1.5 py-0.5 rounded font-mono text-[10px]" style={{ backgroundColor: 'rgba(255,255,255,0.18)' }}>←</kbd>{' '}
        <kbd className="px-1.5 py-0.5 rounded font-mono text-[10px]" style={{ backgroundColor: 'rgba(255,255,255,0.18)' }}>→</kbd>{' '}
        <kbd className="px-1.5 py-0.5 rounded font-mono text-[10px]" style={{ backgroundColor: 'rgba(255,255,255,0.18)' }}>↑</kbd>{' '}
        <kbd className="px-1.5 py-0.5 rounded font-mono text-[10px]" style={{ backgroundColor: 'rgba(255,255,255,0.18)' }}>↓</kbd>{' '}
        <span className="opacity-90">to look around · Press</span>{' '}
        <kbd className="px-1.5 py-0.5 rounded font-mono text-[10px]" style={{ backgroundColor: 'rgba(255,255,255,0.18)' }}>Esc</kbd>{' '}
        <span className="opacity-90">to exit</span>
      </div>
    </div>
  );
}
