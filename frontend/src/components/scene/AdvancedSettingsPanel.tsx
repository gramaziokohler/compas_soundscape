'use client';

import { AdvancedSettingsSection } from '@/components/layout/sidebar/AdvancedSettingsSection';
import type { AdvancedSettingsSectionProps } from '@/components/layout/sidebar/AdvancedSettingsSection';
import { ResizeHandles } from '@/components/ui/ResizeHandles';
import { useFloatingWindow } from '@/hooks/useFloatingWindow';
import { FLOATING_WINDOW } from '@/utils/constants';

interface AdvancedSettingsPanelProps extends AdvancedSettingsSectionProps {
  isVisible: boolean;
  onClose: () => void;
}

export function AdvancedSettingsPanel({ isVisible, onClose, ...settingsProps }: AdvancedSettingsPanelProps) {
  const { rect, startDrag, startResize } = useFloatingWindow({
    storageKey: FLOATING_WINDOW.SETTINGS_PANEL_STORAGE_KEY,
    defaultSize: FLOATING_WINDOW.SETTINGS_PANEL_DEFAULT_SIZE,
    minSize: FLOATING_WINDOW.SETTINGS_PANEL_MIN_SIZE,
    active: isVisible,
  });

  return (
    <div
      className="fixed flex flex-col backdrop-blur-sm shadow-2xl"
      style={{
        left: rect?.x ?? 0,
        top: rect?.y ?? 0,
        width: rect?.w ?? FLOATING_WINDOW.SETTINGS_PANEL_DEFAULT_SIZE.w,
        height: rect?.h ?? FLOATING_WINDOW.SETTINGS_PANEL_DEFAULT_SIZE.h,
        zIndex: 9999,
        display: (isVisible && rect) ? 'flex' : 'none',
        backgroundColor: 'var(--background)',
        border: '1.5px solid var(--color-primary)',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      <ResizeHandles onStart={startResize} />

      {/* Header — drag handle */}
      <div
        className="flex items-center justify-between px-3 flex-shrink-0 touch-none"
        style={{
          height: '40px',
          borderBottom: '1px solid var(--color-secondary-light)',
          cursor: 'grab',
          userSelect: 'none',
          backgroundColor: 'var(--background)',
        }}
        onPointerDown={startDrag}
      >
        <span className="text-sm font-semibold text-foreground">Settings</span>
        <button
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

      {/* Content — scrolls when the panel is smaller than its settings */}
      <div className="flex-1 min-h-0 overflow-auto" style={{ padding: '12px' }}>
        <AdvancedSettingsSection {...settingsProps} />
      </div>
    </div>
  );
}
