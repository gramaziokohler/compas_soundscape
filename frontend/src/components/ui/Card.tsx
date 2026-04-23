'use client';

import { useCallback, useRef, type ReactNode } from 'react';
import type { CardProps, CardBaseConfig } from '@/types/card';
import { CARD_TYPE_LABELS } from '@/types/card';
import { CARD_COLOR_DEFAULT } from '@/utils/constants';
import { useNameEditing } from '@/utils/useNameEditing';

/**
 * Card Component
 *
 * A unified, reusable card UI component for Analysis and Sound generation tabs.
 *
 * **Features:**
 * - Collapse/expanded states with smooth transitions
 * - Editable name (double-click to edit)
 * - Common action buttons (close, reset, custom)
 * - Before/after generation content slots
 * - Loading and error states
 * - Automatic default name generation based on card type
 *
 * **Usage:**
 * ```tsx
 * <Card
 *   config={analysisConfig}
 *   index={0}
 *   isExpanded={true}
 *   hasResult={false}
 *   canRemove={true}
 *   onToggleExpand={handleToggle}
 *   onUpdateConfig={handleUpdate}
 *   onRemove={handleRemove}
 *   onReset={handleReset}
 *   beforeContent={<Model3DContextContent ... />}
 *   afterContent={<AnalysisResultContent ... />}
 * />
 * ```
 */

// ============================================================================
// Default Name Generation
// ============================================================================

/**
 * Get default name for a card based on its type and config
 */
export function getCardDefaultName<TConfig extends CardBaseConfig>(
  config: TConfig,
  index: number
): string {
  // Check for file-based names first
  if ('modelFile' in config && config.modelFile) {
    return (config.modelFile as File).name;
  }
  if ('audioFile' in config && config.audioFile) {
    return (config.audioFile as File).name;
  }

  // Use CARD_TYPE_LABELS as single source of truth
  const baseName = CARD_TYPE_LABELS[config.type] || 'Item';
  if (config.type === 'text') {
    const textInput = (config as any).textInput as string | undefined;
    return textInput?.trim() || `${baseName} ${index + 1}`;
  }
  if (config.type === 'upload' || config.type === 'sample-audio') {
    const filename = (config as any).uploadedAudioInfo?.filename as string | undefined;
    if (filename) return filename.replace(/\.[^/.]+$/, '');
  }
  return baseName;
}

// ============================================================================
// Card Component
// ============================================================================

export function Card<TConfig extends CardBaseConfig>({
  config,
  index,
  isExpanded,
  hasResult,
  result,
  isRunning = false,
  progress = 0,
  status,
  error,
  color = CARD_COLOR_DEFAULT,
  defaultName,
  collapsedInfo,
  version,
  showIndex = true,
  canRemove = true,
  closeButtonTitle = 'Remove',
  resetButtonTitle = 'Reset to configuration',
  customButtons,
  // Simulation action button props
  onRun,
  onCancel,
  actionButtonLabel = 'Start Simulation',
  actionButtonDisabled = false,
  actionButtonColor,
  actionButtonDisabledReason,
  onToggleExpand,
  onUpdateConfig,
  onRemove,
  onReset,
  onDismissError,
  onDoubleClickCard,
  beforeContent,
  afterContent,
  loadingContent,
}: CardProps<TConfig>) {
  // Resolve action button color: explicit prop overrides card color
  const resolvedActionColor = actionButtonColor || color;
  // Compute default name if not provided
  const computedDefaultName = defaultName || getCardDefaultName(config, index);
  const baseName = config.display_name || computedDefaultName;
  const displayName = showIndex ? `${index + 1}. ${baseName}` : baseName;

  // Name editing hook
  const handleSaveName = useCallback((newName: string) => {
    onUpdateConfig(index, { display_name: newName } as Partial<TConfig>);
  }, [index, onUpdateConfig]);

  const {
    isEditing: isEditingName,
    startEdit,
    inputProps,
  } = useNameEditing({
    initialValue: baseName,
    onSave: handleSaveName,
  });

  // CSS custom properties scoped to this card for child theming
  const cardColorStyle = {
    '--card-color': `var(--color-${color})`,
    '--card-color-hover': `var(--color-${color}-hover)`,
    '--card-color-light': `var(--color-${color}-light)`,
    '--card-color-lighter': `var(--color-${color}-lighter)`,
    
    accentColor: `var(--color-${color})`,
  } as React.CSSProperties;

  // Build Tailwind class names
  const cardClassName = [
    'rounded-lg border-0 transition-all duration-200',
    // isExpanded ? `p-2 bg-${color}-light border-0` : hasResult ? `p-1.5 bg-${color}-light` : 'p-1.5 bg-secondary-lighter',
    isExpanded && hasResult ? `p-2 bg-secondary` : '',
    isExpanded && !hasResult ? 'p-2 border-0' : '',
    !isExpanded && hasResult ? `p-2 bg-secondary` : '',
    !isExpanded && !hasResult ? `p-2 bg-secondary-lighter` : '',        

    error ? 'border-error bg-error-light' : '',
  ].filter(Boolean).join(' ');

  const titleClassName = [
    `flex-1 text-left text-xs font-sans font-medium transition-opacity group text-secondary`,
    hasResult ? 'text-white' : 'text-foreground',
  ].filter(Boolean).join(' ');

  // Tracks the expansion state captured at the first click of a potential double-click sequence,
  // so we can restore the original state when the second click fires.
  const stateAtFirstClickRef = useRef<boolean | null>(null);

  // Button handlers
  // Single click (e.detail=1): toggle expand/collapse.
  // Double click (e.detail≥2, only when onDoubleClickCard is provided): zoom to sphere.
  //   Click 1 already toggled the card; on click 2 we restore the card to its
  //   pre-double-click state so double-click always ends with the card expanded.
  const handleToggleClick = useCallback((e: React.MouseEvent) => {
    if (e.detail >= 2 && onDoubleClickCard) {
      if (stateAtFirstClickRef.current === true) {
        // Card was expanded; click 1 collapsed it → re-expand to restore
        onToggleExpand(index);
      }
      // If card was collapsed, click 1 expanded it → already expanded → no toggle needed
      onDoubleClickCard(index);
      stateAtFirstClickRef.current = null;
    } else {
      if (onDoubleClickCard) {
        stateAtFirstClickRef.current = isExpanded; // capture before the toggle
      }
      onToggleExpand(index);
    }
  }, [index, isExpanded, onToggleExpand, onDoubleClickCard]);

  const handleRemoveClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove(index);
  }, [index, onRemove]);

  const handleResetClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onReset(index);
  }, [index, onReset]);

  // Double-click on the card body (outside the header) → zoom to sphere.
  // Skips interactive elements (buttons, inputs, sliders, links) so content UI still works.
  const handleCardDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!onDoubleClickCard) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, select, textarea, a')) return;
    onDoubleClickCard(index);
  }, [index, onDoubleClickCard]);

  // Render content based on state
  // Note: Error display is handled at the Card level (shown before content)
  // to keep all configuration visible when errors occur.
  const renderContent = () => {
    if (isRunning && loadingContent) {
      return (
        <div className="flex items-center justify-center p-4 text-secondary-light text-xs">
          {loadingContent}
        </div>
      );
    }

    if (hasResult && afterContent) {
      return afterContent;
    }

    return beforeContent;
  };

  return (
    <div
      className={cardClassName}
      onDoubleClick={handleCardDoubleClick}
      style={{
        ...cardColorStyle,
        ...(isExpanded && !hasResult && !error ? { borderColor: `var(--color-${color})`, backgroundColor: 'var(--card-color-light)' } : {}),
      }}
    >
      {/* Header - Click anywhere (except buttons) to expand/collapse.
           Double-click to zoom — stops propagation so the outer card's onDoubleClick doesn't fire twice. */}
      <div
        className="flex items-center justify-between gap-2 cursor-pointer"
        onClick={!isEditingName ? handleToggleClick : undefined}
        onDoubleClick={e => e.stopPropagation()}
        style={{ userSelect: 'none' }}
      >
        {/* Title / edit input */}
        {isEditingName ? (
          <input
            {...inputProps}
            onClick={e => e.stopPropagation()}
            className="flex-1 text-xs font-medium px-2 py-1 rounded-lg border bg-background text-foreground outline-none focus:ring-1"
            style={{
              borderColor: 'var(--card-color)',
              userSelect: 'text',
              // @ts-expect-error -- CSS custom property for focus ring
              '--tw-ring-color': 'var(--card-color)',
            }}
          />
        ) : (
          <div
            className={`${titleClassName} min-w-0 overflow-hidden`}
            title={displayName}
          >
            <div className="truncate">
              {displayName}
            </div>
            {!isExpanded && collapsedInfo && (
              <div className="text-xs mt-0.5 text-secondary-hover">
                {collapsedInfo}
              </div>
            )}
            {isExpanded && hasResult && version && (
              <div className="text-[9px] mt-0.5 text-secondary-hover font-mono opacity-60 leading-tight">
                {Array.isArray(version)
                  ? version.map((line, i) => <div key={i}>{line}</div>)
                  : version}
              </div>
            )}
          </div>
        )}

        {/* Pen icon - always visible, click to edit name */}
        {!isEditingName && (
          <button
            onClick={(e) => { e.stopPropagation(); startEdit(); }}
            className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-secondary-hover opacity-40 hover:opacity-100 hover:bg-secondary-light hover:text-foreground transition-all cursor-pointer"
            title="Click to edit name"
            aria-label="Edit name"
          >
            <PenIcon />
          </button>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Custom buttons (if provided) */}
          {customButtons && customButtons.map((button, idx) => (
            <span key={idx}>{button}</span>
          ))}

          {/* Reset button - only show if result exists */}
          {hasResult && (
            <CardButton
              icon={<ResetIcon />}
              title={resetButtonTitle}
              onClick={handleResetClick}
              variant="default"
            />
          )}

          {/* Close button */}
          {canRemove && (
            <CardButton
              icon={<CloseIcon />}
              title={closeButtonTitle}
              onClick={handleRemoveClick}
              variant="close"
            />
          )}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="mt-3 space-y-3">

          {renderContent()}
                    
          {/* Error display - shown before content but keeps configuration visible */}
          {error && (
            <div className="px-2 py-1.5 text-xs rounded-lg bg-error-hover border border-error text-white flex items-start gap-2">
              <span className="flex-1">{error}</span>
              {onDismissError && (
                <CardButton
                  icon={<CloseIcon />}
                  title="Dismiss error"
                  onClick={(e) => { e.stopPropagation(); onDismissError(index); }}
                  variant="close"
                />
              )}
            </div>
          )}

          {/* Action Button / Progress Bar Section (for simulation cards) */}
          {onRun && !hasResult && (
            <>
              {/* Action Button - Show when not running */}
              {!isRunning && (
                <button
                  onClick={onRun}
                  disabled={actionButtonDisabled}
                  className="block mx-auto py-2 px-4 rounded-lg text-xs font-medium transition-all text-white"
                  style={{
                    backgroundColor: actionButtonDisabled ? 'var(--color-secondary-hover)' : `var(--color-${resolvedActionColor})`,
                    cursor: actionButtonDisabled ? 'not-allowed' : 'pointer',
                    opacity: actionButtonDisabled ? 0.4 : 1
                  }}
                  title={actionButtonDisabled ? actionButtonDisabledReason : undefined}
                >
                  {actionButtonLabel}
                </button>
              )}

              {/* Progress Bar with Stop Button - Show when running */}
              {isRunning && (
                <div className="flex gap-2 items-center">
                  <div
                    className="flex-1 px-3 py-2 rounded-lg text-xs"
                    style={{
                      backgroundColor: 'var(--color-secondary-hover)',
                      color: 'white',
                      backgroundImage: `linear-gradient(to right, var(--card-color) ${progress}%, var(--color-secondary-hover) ${progress}%)`,
                      transition: 'background-image 0.3s ease'
                    }}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-medium">{status || 'Calculating...'}</span>
                      <span className="font-bold">{progress}%</span>
                    </div>
                  </div>
                  
                  {/* Stop button */}
                  {onCancel && (
                    <button
                      onClick={onCancel}
                      className="w-8 h-8 rounded-lg text-white font-bold transition-colors flex items-center justify-center flex-shrink-0 bg-error hover:bg-error-hover"
                      title="Stop"
                      aria-label="Stop"
                    >
                      <span className="text-lg leading-none">■</span>
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

export interface CardButtonProps {
  icon: ReactNode;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  variant?: 'default' | 'close' | 'primary';
}

export function CardButton({ icon, title, onClick, disabled = false, variant = 'default' }: CardButtonProps) {
  const variantClasses = {
    default: 'text-secondary-hover hover:bg-secondary-light hover:text-foreground',
    close: 'text-secondary-hover hover:bg-error-light hover:text-error',
    primary: 'text-secondary-hover hover:bg-primary-light hover:text-primary',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${variantClasses[variant]} ${
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
      }`}
      title={title}
    >
      {icon}
    </button>
  );
}

// ============================================================================
// Icons
// ============================================================================

function ResetIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="w-3 h-3"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={4}
        d="M10 19l-7-7m0 0l7-7m-7 7h18"
      />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <span className="text-lg leading-none">×</span>
  );
}

function PenIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z" />
    </svg>
  );
}
