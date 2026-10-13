'use client';

import { useCallback, useRef, useState } from 'react';
import { BarButton } from '@/components/ui/BarButton';
import { Icon } from '@/components/ui/Icon';
import { useDismissOnOutside } from '@/hooks/useDismissOnOutside';
import { useSpeckleStore, useUIStore } from '@/store';
import { RENDER_STYLE, RENDER_STYLE_OPTIONS, SCENE_BOTTOM_BAR } from '@/utils/constants';
import type { RenderStyle } from '@/types';

/**
 * SceneRenderStyleButton Component
 *
 * Bottom-bar dropdown that picks how the model is drawn: Rendered, Ghosted,
 * Arctic or Wireframe. The button shows the current style; the list opens
 * above the bar and closes on pick, outside click or Escape. The style is
 * applied by useSpeckleRenderStyle and survives refresh (uiStore persist).
 * In the Sounds view the viewport keeps its own lighting — the popover says so.
 */
export function SceneRenderStyleButton() {
  const renderStyle = useUIStore((s) => s.renderStyle);
  const setRenderStyle = useUIStore((s) => s.setRenderStyle);
  const isSoundsView = useSpeckleStore((s) => s.viewMode === 'dark');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissOnOutside(rootRef, open, close);

  const current = RENDER_STYLE_OPTIONS.find((o) => o.value === renderStyle) ?? RENDER_STYLE_OPTIONS[0];

  const pick = (style: RenderStyle) => {
    setRenderStyle(style);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative flex items-center">
      <BarButton
        onClick={() => setOpen((v) => !v)}
        active={open}
        title={`Render style — ${current.label}`}
        label={current.label}
        icon={
          <Icon size={`${SCENE_BOTTOM_BAR.ICON_SIZE}px`}>
            <path d="M12 2 3 7v10l9 5 9-5V7z" />
            <path d="M3 7l9 5 9-5M12 12v10" />
          </Icon>
        }
      />
      {open && (
        <div
          className="bar-popover"
          role="listbox"
          aria-label="Render style"
          style={{
            right: 0,
            position: 'absolute',
            bottom: `calc(100% + ${SCENE_BOTTOM_BAR.POPOVER_OFFSET}px)`,
            width: RENDER_STYLE.POPOVER_WIDTH,
            padding: '4px',
          }}
        >
          <div className="bar-popover__title" style={{ padding: '0 8px' }}>Render style</div>
          {isSoundsView && <div className="bar-option__note">{RENDER_STYLE.SOUNDS_MODE_NOTE}</div>}
          {RENDER_STYLE_OPTIONS.map((option) => {
            const selected = option.value === renderStyle;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                data-active={selected}
                className="bar-option"
                onClick={() => pick(option.value)}
              >
                <span className="bar-option__label">{option.label}</span>
                <span className="bar-option__hint">{option.description}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
