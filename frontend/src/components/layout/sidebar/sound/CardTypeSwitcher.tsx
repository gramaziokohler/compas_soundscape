'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { CardType } from '@/types';
import type { CardTypeOption } from '@/components/ui/CardSection';

/**
 * CardTypeSwitcher Component
 *
 * A button with dropdown that allows switching a sound card's type.
 * Shows all available types with the current type greyed out.
 *
 * Used in sound cards (before simulation) to change between:
 * - text-to-audio
 * - upload
 * - library
 * - sample-audio
 */

export interface CardTypeSwitcherProps {
  /** Current card type */
  currentType: CardType;
  /** Available card types for the dropdown */
  availableTypes: CardTypeOption[];
  /** Callback when a new type is selected */
  onSwitchType: (newType: CardType) => void;
}

export function CardTypeSwitcher({
  currentType,
  availableTypes,
  onSwitchType,
}: CardTypeSwitcherProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDropdown]);

  // Handle type selection
  const handleTypeSelect = useCallback((type: CardType) => {
    if (type !== currentType) {
      onSwitchType(type);
    }
    setShowDropdown(false);
  }, [currentType, onSwitchType]);

  // Toggle dropdown
  const handleButtonClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDropdown(prev => !prev);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Switch button */}
      <button
        onClick={handleButtonClick}
        className="w-5 h-5 flex items-center justify-center rounded-full transition-colors text-secondary-hover hover:bg-secondary-light hover:text-foreground"
        title="Switch card type"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-3 w-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
          />
        </svg>
      </button>

      {/* Type selector dropdown */}
      {showDropdown && (
        <div className="absolute right-0 mt-1 z-[100] rounded-lg shadow-lg bg-background border border-secondary-light min-w-[150px] overflow-hidden">
          {availableTypes.map((option, idx) => {
            const isCurrent = option.type === currentType;
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
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isCurrent) handleTypeSelect(option.type);
                }}
                disabled={isCurrent}
                className={`w-full text-left px-3 py-2 text-xs transition-colors ${roundedClass} ${
                  isCurrent
                    ? 'text-secondary-hover cursor-not-allowed bg-secondary-light'
                    : 'text-foreground cursor-pointer hover:bg-primary hover:text-white'
                }`}
                title={isCurrent ? 'Current type' : `Switch to ${option.label}`}
              >
                {option.label}
                {isCurrent && (
                  <span className="ml-2 text-[10px] opacity-60">(current)</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
