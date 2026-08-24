'use client';

/**
 * MaterialSelect
 *
 * Custom dropdown for acoustic material assignment.
 * - Trigger identical in size/colour to the original <select>
 * - List opens upward or downward based on available viewport space
 * - List is as wide as the longest option (max-content)
 * - Hovering an option shows a 260×156 absorption-spectrum histogram to its left
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { UI_BORDER_RADIUS } from '@/utils/constants';
import { drawAbsorptionHistogram } from '@/lib/audio/utils/absorption-histogram-utils';
import { getScale } from '@/utils/scale';
import { SearchBar } from '@/components/ui/SearchBar';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MaterialOption {
  id: string;
  name: string;
  absorption: number;
  coeffs?: number[];
  center_freqs?: number[];
}

interface MaterialSelectProps {
  value: string;
  onChange: (value: string) => void;
  materials: MaterialOption[];
  materialColors: Map<string, string>;
  placeholder?: string;
  /** Applied to the trigger only, matching the original <select> opacity behaviour */
  opacity?: number;
  /** When true and no value selected, show the trigger in pink instead of grey */
  isMixed?: boolean;
  /** When true, opening the dropdown replaces the trigger with a search box that filters options by name */
  showSearch?: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const HIST_W = 260;
const HIST_H = 156;
const LIST_MAX_HEIGHT = 160;

// ── Component ──────────────────────────────────────────────────────────────────

export function MaterialSelect({
  value,
  onChange,
  materials,
  materialColors,
  placeholder = 'Select...',
  opacity = 1,
  isMixed = false,
  showSearch = false,
}: MaterialSelectProps) {
  const [isOpen, setIsOpen]       = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [histPos, setHistPos]     = useState<{ x: number; y: number } | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const [searchQuery, setSearchQuery] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef   = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement | null>(null);

  const selectedMat  = materials.find((m) => m.id === value);
  const triggerBg    = value
    ? (materialColors.get(value) ?? 'var(--color-secondary-hover)')
    : isMixed
      ? 'var(--color-mixed)'
      : 'var(--color-secondary-hover)';
  const triggerLabel = selectedMat
    ? `${selectedMat.name} (${(selectedMat.absorption * 100).toFixed(0)}%)`
    : placeholder;

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setHoveredId(null);
        setHistPos(null);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isOpen]);

  // Redraw histogram when hovered material changes
  useEffect(() => {
    if (!canvasRef.current || !hoveredId) return;
    const mat = materials.find((m) => m.id === hoveredId);
    if (mat?.coeffs && mat.center_freqs) {
      drawAbsorptionHistogram(canvasRef.current, mat.coeffs, mat.center_freqs);
    }
  }, [hoveredId, materials]);

  // Clear the search query whenever the dropdown closes
  useEffect(() => {
    if (!isOpen) setSearchQuery('');
  }, [isOpen]);

  // Filter options by name when search is active
  const filteredMaterials = useMemo(() => {
    if (!showSearch || !searchQuery.trim()) return materials;
    const q = searchQuery.trim().toLowerCase();
    return materials.filter((mat) => mat.name.toLowerCase().includes(q));
  }, [materials, searchQuery, showSearch]);

  const handleTriggerClick = () => {
    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const vp = getScale().viewport;
      const spaceBelow = vp.height - rect.bottom;
      const wantsUpward = spaceBelow < LIST_MAX_HEIGHT && rect.top > spaceBelow;
      setOpenUpward(wantsUpward);
      setDropdownPos({
        left: rect.left,
        top: wantsUpward ? rect.top - LIST_MAX_HEIGHT - 2 : rect.bottom + 2,
      });
    }
    setIsOpen((prev) => !prev);
  };

  const handleOptionEnter = useCallback((e: React.MouseEvent<HTMLDivElement>, matId: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredId(matId);
    setHistPos({
      x: rect.left - HIST_W - 8,
      y: Math.max(4, Math.min(getScale().viewport.height - HIST_H - 4, rect.top + rect.height / 2 - HIST_H / 2)),
    });
  }, []);

  const handleOptionLeave = useCallback(() => {
    setHoveredId(null);
    setHistPos(null);
  }, []);

  const hoveredMat    = hoveredId ? materials.find((m) => m.id === hoveredId) : null;
  const showHistogram = !!(hoveredMat?.coeffs && hoveredMat.center_freqs && histPos);

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '140px', flexShrink: 0 }}
    >
      {/* ── Trigger ─ same width/height/colours as original <select> ──────────── */}
      {/* When open with search enabled, the trigger slot becomes a search box that filters the list below */}
      {isOpen && showSearch ? (
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search materials..."
          autoFocus
          debounceMs={0}
          className="w-full"
        />
      ) : (
        <div
          ref={triggerRef}
          role="button"
          tabIndex={0}
          onClick={handleTriggerClick}
          onKeyDown={(e) => e.key === 'Enter' && handleTriggerClick()}
          onMouseEnter={(e) => {
            if (!selectedMat?.coeffs || !selectedMat.center_freqs) return;
            const rect = e.currentTarget.getBoundingClientRect();
            setHoveredId(selectedMat.id);
            setHistPos({
              x: rect.left - HIST_W - 8,
              y: Math.max(4, Math.min(getScale().viewport.height - HIST_H - 4, rect.top + rect.height / 2 - HIST_H / 2)),
            });
          }}
          onMouseLeave={() => {
            if (!isOpen) { setHoveredId(null); setHistPos(null); }
          }}
          className="select-trigger compact text-xs rounded cursor-pointer focus:outline-none"
          style={{
            backgroundColor: triggerBg,
            opacity,
            width: '100%',
            boxSizing: 'border-box',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            userSelect: 'none',
          }}
        >
          {triggerLabel}
        </div>
      )}

      {/* ── Dropdown list ─────────────────────────────────────────────────────── */}
      {isOpen && (
        <div
            className="select-menu compact"
            style={{
            position: 'fixed',
            left: dropdownPos.left,
            top: dropdownPos.top,
            width: 'max-content',
            right: 'auto',
            maxHeight: `${LIST_MAX_HEIGHT}px`,
            overflowY: 'auto',
            zIndex: 99999,
            backgroundColor: 'var(--color-surface-2)',
          }}
        >
          {/* Placeholder / clear option */}
          <div
            className="select-opt compact cursor-pointer"
            style={{ color: 'var(--color-secondary-hover)', backgroundColor: 'var(--color-surface-2)' }}
            onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.15)')}
            onMouseLeave={(e)  => (e.currentTarget.style.filter = '')}
            onClick={() => { onChange(''); setIsOpen(false); }}
          >
            {placeholder}
          </div>

          {filteredMaterials.length === 0 ? (
            <div
              className="select-opt compact"
              style={{ color: 'var(--color-secondary-hover)', backgroundColor: 'var(--color-surface-2)', cursor: 'default' }}
            >
              No materials found
            </div>
          ) : (
            filteredMaterials.map((mat) => {
              const bg = materialColors.get(mat.id) ?? 'var(--color-secondary-hover)';
              return (
                <div
                  key={mat.id}
                  className="select-opt compact text-white cursor-pointer"
                  style={{ backgroundColor: bg, color: '#fff' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.filter = 'brightness(1.15)';
                    handleOptionEnter(e, mat.id);
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.filter = '';
                    handleOptionLeave();
                  }}
                  onClick={() => {
                    onChange(mat.id);
                    setIsOpen(false);
                    setHoveredId(null);
                    setHistPos(null);
                  }}
                >
                  {mat.name} ({(mat.absorption * 100).toFixed(0)}%)
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Histogram ─ fixed-positioned to the left of the hovered option ──── */}
      {showHistogram && histPos && (
        <div
          className="fixed pointer-events-none"
          style={{
            left: Math.max(4, histPos.x),
            top: histPos.y,
            width: HIST_W,
            height: HIST_H,
            borderRadius: `${UI_BORDER_RADIUS.SM}px`,
            overflow: 'hidden',
            border: '1px solid var(--color-secondary-light)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.7)',
            zIndex: 99999,
          }}
        >
          <canvas
            ref={canvasRef}
            width={HIST_W}
            height={HIST_H}
            style={{ display: 'block' }}
          />
        </div>
      )}
    </div>
  );
}
