'use client';

/**
 * MaterialSelect
 *
 * Acoustic material dropdown built on `CardSelect`. Options show a colour badge;
 * hovering an option in the expanded list shows a histogram preview.
 * The collapsed trigger shows a small bars-only histogram icon; clicking it
 * scales up the full histogram from the icon's center. The popup closes when
 * the pointer leaves it. If mouseleave is skipped (e.g. scrolling the option
 * list), the preview also hides 1s after the pointer is no longer over it.
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { UI_BORDER_RADIUS, MATERIAL_SELECT } from '@/utils/constants';
import { buildAbsorptionHistogramSVG, buildMiniHistogramSVG } from '@/lib/audio/utils/absorption-histogram-utils';
import { getScale } from '@/utils/scale';
import { SearchBar } from '@/components/ui/SearchBar';
import { CardSelect, type CardSelectOption } from '@/components/ui/CardSelect';

export interface MaterialOption {
  id: string;
  name: string;
  absorption: number;
  coeffs?: number[];
  center_freqs?: number[];
}

export type MaterialSelectVariant = 'explorer' | 'resonance';

interface MaterialSelectProps {
  value: string;
  onChange: (value: string) => void;
  materials: MaterialOption[];
  materialColors: Map<string, string>;
  placeholder?: string;
  isMixed?: boolean;
  showSearch?: boolean;
  /** Layout preset — sets max widths and right-alignment defaults. */
  variant?: MaterialSelectVariant;
  /** When false, the clear / placeholder row is omitted from the menu. */
  allowClear?: boolean;
  fitContent?: boolean;
  alignRight?: boolean;
}

/** Full histogram popup dimensions (75 % of old 260×156). */
const HIST_W = 195;
const HIST_H = 117;
const LIST_MAX_HEIGHT = 160;

/** Mini icon size (px) — fits inside tree-item row height. */
const MINI_ICON_SIZE = 18;
/** Fallback hide delay when the pointer has left but mouseleave did not fire (e.g. list scroll). */
const HIST_POINTER_OFF_HIDE_MS = 1000;

const VARIANT_DEFAULTS: Record<MaterialSelectVariant, {
  triggerMaxWidth?: number;
  menuMaxWidth: number;
  fitContent: boolean;
  alignRight: boolean;
}> = {
  explorer: {
    triggerMaxWidth: MATERIAL_SELECT.OBJECT_EXPLORER_TRIGGER_MAX_PX,
    menuMaxWidth: MATERIAL_SELECT.OBJECT_EXPLORER_MENU_MAX_PX,
    fitContent: true,
    alignRight: true,
  },
  resonance: {
    menuMaxWidth: MATERIAL_SELECT.RESONANCE_MENU_MAX_PX,
    fitContent: true,
    alignRight: true,
  },
};

function materialLabel(mat: MaterialOption): string {
  return `${mat.name} (${(mat.absorption * 100).toFixed(0)}%)`;
}

function isPointerOverHistogramUi(x: number, y: number): boolean {
  const el = document.elementFromPoint(x, y);
  if (!el) return false;
  return !!(el.closest('[data-absorption-histogram]') || el.closest('.select-menu'));
}

export function MaterialSelect({
  value,
  onChange,
  materials,
  materialColors,
  placeholder = 'Select...',
  isMixed = false,
  showSearch = false,
  variant = 'explorer',
  allowClear = true,
  fitContent: fitContentProp,
  alignRight: alignRightProp,
}: MaterialSelectProps) {
  const variantDefaults = VARIANT_DEFAULTS[variant];
  const fitContent = fitContentProp ?? variantDefaults.fitContent;
  const alignRight = alignRightProp ?? variantDefaults.alignRight;

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [histPos, setHistPos] = useState<{ x: number; y: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  /** Whether the histogram is triggered by the mini icon (scale-from-center) vs option hover. */
  const [histFromIcon, setHistFromIcon] = useState(false);
  const histFromIconRef = useRef(false);
  const histArmedRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const [iconCenter, setIconCenter] = useState<{ x: number; y: number } | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const hideHistogram = useCallback(() => {
    clearHideTimer();
    histFromIconRef.current = false;
    histArmedRef.current = false;
    setHoveredId(null);
    setHistPos(null);
    setHistFromIcon(false);
    setIconCenter(null);
  }, [clearHideTimer]);

  const scheduleHideIfPointerOff = useCallback(() => {
    if (hideTimerRef.current !== null) return;
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      hideHistogram();
    }, HIST_POINTER_OFF_HIDE_MS);
  }, [hideHistogram]);

  const selectedMat = materials.find((m) => m.id === value);

  const filteredMaterials = useMemo(() => {
    if (!showSearch || !searchQuery.trim()) return materials;
    const q = searchQuery.trim().toLowerCase();
    return materials.filter((mat) => mat.name.toLowerCase().includes(q));
  }, [materials, searchQuery, showSearch]);

  const cardOptions: CardSelectOption[] = useMemo(() => {
    const materialOpts: CardSelectOption[] = filteredMaterials.map((mat) => ({
      value: mat.id,
      label: materialLabel(mat),
      badgeColor: materialColors.get(mat.id) ?? 'var(--color-secondary-hover)',
    }));

    if (showSearch && searchQuery.trim() && materialOpts.length === 0) {
      const empty: CardSelectOption[] = [{ value: '__empty__', label: 'No materials found', disabled: true }];
      if (allowClear) {
        return [{ value: '', label: placeholder, style: { color: 'var(--color-primary)' } }, ...empty];
      }
      return empty;
    }

    if (!allowClear) return materialOpts;

    return [
      { value: '', label: placeholder, style: { color: 'var(--color-primary)' } },
      ...materialOpts,
    ];
  }, [filteredMaterials, materialColors, placeholder, allowClear, showSearch, searchQuery]);

  const triggerStyle = useMemo((): CSSProperties => {
    if (!value) {
      if (isMixed) return { color: 'var(--color-mixed)' };
      return { color: 'var(--color-primary)' };
    }
    return {};
  }, [value, isMixed]);

  const triggerBadgeColor = value
    ? (materialColors.get(value) ?? 'var(--color-secondary-hover)')
    : undefined;

  /** Position the full histogram next to an anchor rect (for option hover). */
  const showHistogramFor = useCallback((matId: string, anchorRect: DOMRect) => {
    const mat = materials.find((m) => m.id === matId);
    if (!mat?.coeffs || !mat.center_freqs) return;

    histFromIconRef.current = false;
    setHoveredId(matId);
    setHistFromIcon(false);
    setIconCenter(null);

    const vp = getScale().viewport;
    const spaceLeft = anchorRect.left;
    const spaceRight = vp.width - anchorRect.right;
    const fitsLeft = spaceLeft >= HIST_W + 8;
    const fitsRight = spaceRight >= HIST_W + 8;
    const preferLeft = fitsLeft && (!fitsRight || spaceLeft >= spaceRight);

    let x: number;
    if (preferLeft) {
      x = anchorRect.left - HIST_W - 8;
    } else if (fitsRight) {
      x = anchorRect.right + 8;
    } else {
      x = Math.max(4, Math.min(anchorRect.left, vp.width - HIST_W - 4));
    }

    setHistPos({
      x: Math.max(4, Math.min(x, vp.width - HIST_W - 4)),
      y: Math.max(4, Math.min(vp.height - HIST_H - 4, anchorRect.top + anchorRect.height / 2 - HIST_H / 2)),
    });
  }, [materials]);

  const handleOptionEnter = useCallback((opt: CardSelectOption, e: React.MouseEvent<HTMLDivElement>) => {
    if (!opt.value) return;
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    clearHideTimer();
    showHistogramFor(opt.value, e.currentTarget.getBoundingClientRect());
  }, [showHistogramFor, clearHideTimer]);

  const handleOptionLeave = useCallback(() => {
    if (histFromIconRef.current) return;
    scheduleHideIfPointerOff();
  }, [scheduleHideIfPointerOff]);

  /** Show full histogram scaled from the mini icon center. */
  const handleIconClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedMat?.coeffs || !selectedMat.center_freqs) return;

    if (histFromIconRef.current) {
      hideHistogram();
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    lastPointerRef.current = { x: cx, y: cy };
    histFromIconRef.current = true;
    histArmedRef.current = false;
    setHoveredId(selectedMat.id);
    setHistFromIcon(true);
    setIconCenter({ x: cx, y: cy });
    setHistPos({ x: cx - HIST_W / 2, y: cy - HIST_H / 2 });
    window.setTimeout(() => { histArmedRef.current = true; }, 50);
  }, [selectedMat, hideHistogram]);

  const handleHistMouseEnter = useCallback(() => {
    clearHideTimer();
  }, [clearHideTimer]);

  const handleHistMouseLeave = useCallback(() => {
    if (!histFromIconRef.current || !histArmedRef.current) return;
    scheduleHideIfPointerOff();
  }, [scheduleHideIfPointerOff]);

  const hoveredMat = hoveredId ? materials.find((m) => m.id === hoveredId) : null;
  const showHistogram = !!(hoveredMat?.coeffs && hoveredMat.center_freqs && histPos);
  const histSvg = hoveredMat?.coeffs && hoveredMat.center_freqs
    ? buildAbsorptionHistogramSVG(hoveredMat.coeffs, hoveredMat.center_freqs)
    : '';

  useEffect(() => {
    if (!showHistogram) {
      clearHideTimer();
      return;
    }

    const considerPointer = (x: number, y: number) => {
      lastPointerRef.current = { x, y };
      if (isPointerOverHistogramUi(x, y)) {
        clearHideTimer();
      } else {
        scheduleHideIfPointerOff();
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      considerPointer(e.clientX, e.clientY);
    };
    const onScroll = () => {
      const { x, y } = lastPointerRef.current;
      considerPointer(x, y);
    };

    document.addEventListener('pointermove', onPointerMove);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [showHistogram, clearHideTimer, scheduleHideIfPointerOff]);

  // Build mini icon SVG for the trigger
  const miniIconSvg = useMemo(() => {
    if (!selectedMat?.coeffs) return null;
    return buildMiniHistogramSVG(selectedMat.coeffs, MINI_ICON_SIZE);
  }, [selectedMat]);

  return (
    <>
      <div className="material-select flex items-center gap-1 min-w-0">
        {miniIconSvg && (
          <button
            type="button"
            className="shrink-0 cursor-pointer p-0 border-0 bg-transparent"
            style={{ width: MINI_ICON_SIZE, height: MINI_ICON_SIZE, borderRadius: 2, overflow: 'hidden' }}
            aria-label="Show absorption histogram"
            onClick={handleIconClick}
            dangerouslySetInnerHTML={{ __html: miniIconSvg }}
          />
        )}
        <CardSelect
          value={value}
          onChange={onChange}
          options={cardOptions}
          placeholder={placeholder}
          forceMenu
          compact
          fitContent={fitContent}
          alignMenu={alignRight ? 'right' : 'left'}
          menuWidth="content"
          menuMaxHeight={LIST_MAX_HEIGHT}
          {...(variantDefaults.triggerMaxWidth !== undefined
            ? { triggerMaxWidth: variantDefaults.triggerMaxWidth }
            : {})}
          menuMaxWidth={variantDefaults.menuMaxWidth}
          triggerStyle={triggerStyle}
          triggerBadgeColor={triggerBadgeColor}
          menuHeader={showSearch ? (
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search materials..."
              autoFocus
              debounceMs={0}
              className="w-full"
            />
          ) : undefined}
          onOpenChange={(open) => {
            if (!open) {
              setSearchQuery('');
              if (!histFromIconRef.current) hideHistogram();
            }
          }}
          onOptionMouseEnter={handleOptionEnter}
          onOptionMouseLeave={handleOptionLeave}
        />
      </div>

      {showHistogram && histPos && (
        <div
          data-absorption-histogram=""
          className={histFromIcon ? 'fixed' : 'fixed pointer-events-none'}
          onMouseEnter={handleHistMouseEnter}
          onMouseLeave={handleHistMouseLeave}
          dangerouslySetInnerHTML={{ __html: histSvg }}
          style={{
            left: histPos.x,
            top: histPos.y,
            width: HIST_W,
            height: HIST_H,
            borderRadius: `${UI_BORDER_RADIUS.SM}px`,
            overflow: 'hidden',
            border: '1px solid var(--color-secondary-light)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 100000,
            ...(histFromIcon && iconCenter
              ? {
                  transformOrigin: `${iconCenter.x - histPos.x}px ${iconCenter.y - histPos.y}px`,
                  animation: 'hist-scale-in 0.15s ease-out forwards',
                }
              : {}),
          }}
        />
      )}
    </>
  );
}
