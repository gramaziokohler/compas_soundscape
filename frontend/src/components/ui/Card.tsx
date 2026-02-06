'use client';

import { useCallback, type ReactNode } from 'react';
import type { CardProps, CardBaseConfig } from '@/types/card';
import { CARD_TYPE_LABELS } from '@/types/card';
import { useNameEditing } from '@/lib/utils/useNameEditing';

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
  return config.type === 'text' ? `${baseName} ${index + 1}` : baseName;
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
  defaultName,
  collapsedInfo,
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
  actionButtonColor = 'primary',
  actionButtonDisabledReason,
  onToggleExpand,
  onUpdateConfig,
  onRemove,
  onReset,
  beforeContent,
  afterContent,
  loadingContent,
}: CardProps<TConfig>) {
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

  // Build Tailwind class names
  const cardClassName = [
    'rounded-lg border transition-all duration-200',
    isExpanded ? 'p-3' : 'p-2',
    hasResult
      ? 'bg-secondary border-secondary-hover'
      : 'bg-background border-secondary-light',
    error ? 'border-error bg-error-light' : '',
  ].filter(Boolean).join(' ');

  const titleClassName = [
    'flex-1 text-left text-sm font-medium cursor-pointer transition-opacity group',
    hasResult ? 'text-background' : 'text-foreground',
  ].filter(Boolean).join(' ');

  // Button handlers
  const handleToggleClick = useCallback(() => {
    onToggleExpand(index);
  }, [index, onToggleExpand]);

  const handleRemoveClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove(index);
  }, [index, onRemove]);

  const handleResetClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onReset(index);
  }, [index, onReset]);

  // Render content based on state
  // Note: Error display is handled at the Card level (shown before content)
  // to keep all configuration visible when errors occur.
  const renderContent = () => {
    if (isRunning && loadingContent) {
      return (
        <div className="flex items-center justify-center p-4 text-secondary-hover text-sm">
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
    <div className={cardClassName}>
      {/* Header - Always visible */}
      <div className="flex items-center justify-between gap-2">
        {/* Title - editable on double-click */}
        {isEditingName ? (
          <input
            {...inputProps}
            className="flex-1 text-sm font-medium px-2 py-1 rounded-lg border border-primary bg-background text-foreground outline-none focus:ring-1 focus:ring-primary"
          />
        ) : (
          <div
            onDoubleClick={startEdit}
            onClick={handleToggleClick}
            className={`${titleClassName} min-w-0 overflow-hidden`}
            title="Double-click to edit name"
          >
            <div className="truncate">
              {displayName}
              <span className="text-[10px] ml-1 opacity-0 group-hover:opacity-50 transition-opacity">✏️</span>
            </div>
            {!isExpanded && collapsedInfo && (
              <div className="text-xs mt-0.5 text-secondary-hover">
                {collapsedInfo}
              </div>
            )}
          </div>
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
            <div className="p-2 text-xs rounded-lg bg-error-hover border border-error text-white">
              {error}
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
                  className="w-full py-2 px-4 rounded-lg text-xs font-medium transition-all text-white"
                  style={{
                    backgroundColor: actionButtonDisabled ? 'var(--color-secondary-hover)' : `var(--color-${actionButtonColor})`,
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
                      backgroundImage: `linear-gradient(to right, var(--color-primary) ${progress}%, var(--color-secondary-hover) ${progress}%)`,
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

interface CardButtonProps {
  icon: ReactNode;
  title: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  variant?: 'default' | 'close' | 'primary';
}

function CardButton({ icon, title, onClick, disabled = false, variant = 'default' }: CardButtonProps) {
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

function CloseIcon() {
  return (
    <span className="text-lg leading-none">×</span>
  );
}
