'use client';

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import type { CardType, CardBaseConfig } from '@/types/card';

/**
 * CardSection Component
 *
 * A generic section template that provides:
 * - Expand/collapse management (single expansion)
 * - "Add" button with type selector dropdown
 * - Status display (count, pending)
 * - Scrolling to newly added/expanded items
 *
 * Used by AnalysisSection and SoundSection to reduce duplication.
 *
 * **Usage:**
 * ```tsx
 * <CardSection
 *   items={analysisConfigs}
 *   availableTypes={[
 *     { type: '3d-model', label: '3D Model Context', enabled: hasModelLoaded },
 *     { type: 'audio', label: 'Audio Context', enabled: true },
 *     { type: 'text', label: 'Text Context', enabled: true },
 *   ]}
 *   emptyMessage="No analysis contexts yet."
 *   statusLabel="context"
 *   addButtonTitle="Add context analysis"
 *   onAddItem={onAddConfig}
 *   renderCard={(item, index, isExpanded, onToggleExpand) => (
 *     <Card ... />
 *   )}
 *   footer={<SendToGenerationButton />}
 * />
 * ```
 */

// ============================================================================
// Types
// ============================================================================

export interface CardTypeOption {
  /** Card type identifier */
  type: CardType;
  /** Display label in dropdown */
  label: string;
  /** Whether this option is enabled */
  enabled: boolean;
  /** Tooltip when disabled */
  disabledTooltip?: string;
}

export interface CardSectionProps<TItem extends CardBaseConfig> {
  /** List of items to render as cards */
  items: TItem[];
  /** Available types for the add button dropdown */
  availableTypes: CardTypeOption[];
  /** Message shown when items list is empty */
  emptyMessage: string;
  /** Label for status display (e.g., "context", "sound") */
  statusLabel: string;
  /** Title for the add button */
  addButtonTitle: string;
  /** Callback when adding a new item */
  onAddItem: (type: CardType) => void;
  /** Render function for each card */
  renderCard: (
    item: TItem,
    index: number,
    isExpanded: boolean,
    onToggleExpand: (index: number) => void
  ) => ReactNode;
  /** Optional footer content (e.g., submit button) */
  footer?: ReactNode;
  /** Calculate pending count (items without results) */
  getPendingCount?: (items: TItem[]) => number;
  /** Whether the section is currently running an operation */
  isRunning?: boolean;
  /** Error message to display */
  error?: string | null;
  /**
   * Controlled mode: Externally controlled expanded index.
   * When provided, CardSection becomes a controlled component.
   */
  expandedIndex?: number | null;
  /**
   * Controlled mode: Callback when expanded index changes.
   * Required when using controlled mode (expandedIndex prop).
   */
  onExpandedIndexChange?: (index: number | null) => void;
}

// ============================================================================
// Component
// ============================================================================

export function CardSection<TItem extends CardBaseConfig>({
  items,
  availableTypes,
  emptyMessage,
  statusLabel,
  addButtonTitle,
  onAddItem,
  renderCard,
  footer,
  getPendingCount,
  isRunning = false,
  error,
  expandedIndex: controlledExpandedIndex,
  onExpandedIndexChange,
}: CardSectionProps<TItem>) {
  // Determine if we're in controlled mode
  const isControlled = controlledExpandedIndex !== undefined;

  // Track which card is expanded (only one at a time) - used in uncontrolled mode
  const [internalExpandedIndex, setInternalExpandedIndex] = useState<number | null>(
    items.length > 0 ? 0 : null
  );

  // Use controlled or internal state based on mode
  const expandedIndex = isControlled ? controlledExpandedIndex : internalExpandedIndex;

  // Track type selector dropdown visibility
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const typeSelectorRef = useRef<HTMLDivElement>(null);

  // Refs for scrolling
  const listRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Toggle expansion (only one can be expanded)
  const handleToggleExpand = useCallback((index: number) => {
    const newIndex = expandedIndex === index ? null : index;

    // If controlled, call the callback
    if (isControlled && onExpandedIndexChange) {
      onExpandedIndexChange(newIndex);
    } else {
      // Uncontrolled mode - update internal state
      setInternalExpandedIndex(newIndex);
    }

    // Scroll to card after expansion
    if (newIndex !== null) {
      setTimeout(() => {
        const cardElement = cardRefs.current.get(index);
        cardElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    }
  }, [expandedIndex, isControlled, onExpandedIndexChange]);

  // Auto-expand newly added item (only in uncontrolled mode)
  useEffect(() => {
    if (!isControlled && items.length > 0) {
      const lastIndex = items.length - 1;
      setInternalExpandedIndex(lastIndex);
    }
  }, [items.length, isControlled]);

  // Close type selector when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (typeSelectorRef.current && !typeSelectorRef.current.contains(event.target as Node)) {
        setShowTypeSelector(false);
      }
    };

    if (showTypeSelector) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showTypeSelector]);

  // Handle type selection
  const handleTypeSelect = useCallback((type: CardType) => {
    onAddItem(type);
    setShowTypeSelector(false);
  }, [onAddItem]);

  // Calculate status
  const totalCount = items.length;
  const pendingCount = getPendingCount ? getPendingCount(items) : 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Status bar with add button */}
      <div className="flex items-center text-xs w-full gap-1 text-secondary-hover">
        {totalCount} {statusLabel}{totalCount !== 1 ? 's' : ''}
        {pendingCount > 0 && (
          <span> ({pendingCount} pending)</span>
        )}

        {/* Add button with type selector dropdown */}
        <div className="ml-auto relative" ref={typeSelectorRef}>
          <button
            onClick={() => setShowTypeSelector(!showTypeSelector)}
            className="w-8 h-8 rounded-lg text-white font-bold transition-colors flex items-center justify-center bg-primary hover:bg-secondary-hover"
            title={addButtonTitle}
            aria-label={addButtonTitle}
          >
            <span className="text-lg leading-none">+</span>
          </button>

          {/* Type selector dropdown */}
          {showTypeSelector && (
            <div className="absolute right-0 mt-1 z-[100] rounded-lg shadow-lg bg-white border border-secondary-light min-w-[200px] overflow-hidden">
              {availableTypes.map((option, idx) => {
                const isFirst = idx === 0;
                const isLast = idx === availableTypes.length - 1;
                const roundedClass = isFirst && isLast
                  ? 'rounded-lg'
                  : isFirst
                    ? 'rounded-t-lg'
                    : isLast
                      ? 'rounded-b-lg'
                      : '';

                return (
                  <button
                    key={option.type}
                    onClick={() => option.enabled ? handleTypeSelect(option.type) : null}
                    disabled={!option.enabled}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${roundedClass} ${
                      option.enabled
                        ? 'text-foreground cursor-pointer hover:bg-primary hover:text-white'
                        : 'text-secondary-hover cursor-not-allowed opacity-60'
                    }`}
                    title={option.enabled ? option.label : option.disabledTooltip}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Card list */}
      <div ref={listRef} className="flex flex-col gap-2">
        {items.length === 0 ? (
          <div className="rounded-lg p-4 text-xs text-center bg-secondary-light text-secondary-hover">
            {emptyMessage}
          </div>
        ) : (
          items.map((item, index) => (
            <div
              key={index}
              ref={(el) => {
                if (el) {
                  cardRefs.current.set(index, el);
                } else {
                  cardRefs.current.delete(index);
                }
              }}
            >
              {renderCard(item, index, expandedIndex === index, handleToggleExpand)}
            </div>
          ))
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="p-3 text-sm rounded-lg bg-error-light border border-error text-error">
          {error}
        </div>
      )}

      {/* Footer (optional) */}
      {footer}
    </div>
  );
}
