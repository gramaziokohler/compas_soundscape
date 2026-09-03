'use client';

import { useCallback, useRef, useState, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CardProps, CardBaseConfig } from '@/types/card';
import { CARD_TYPE_LABELS, CARD_TYPE_DESCRIPTIONS } from '@/types/card';
import { useNameEditing } from '@/utils/useNameEditing';
import { GenerateButton, type GenerateStatus } from '@/components/ui/GenerateButton';
import { VariantsBar } from '@/components/ui/VariantsBar';
import { Notice } from '@/components/ui/Notice';
import { SettingsSummary, getSettingsTitle, getSettingsRows } from '@/components/ui/SettingsSummary';
import { InfoPopover } from '@/components/ui/InfoPopover';

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
  color = 'primary' as const,
  defaultName,
  collapsedInfo,
  isPlayingCollapsedInfo = false,
  version,
  showIndex = true,
  canRemove = true,
  closeButtonTitle = 'Remove',
  resetButtonTitle = 'Reset to configuration',
  customButtons,
  headerPrefix,
  // Simulation action button props
  onRun,
  onCancel,
  actionButtonLabel = 'Start Simulation',
  actionButtonDisabled = false,
  actionButtonColor,
  actionButtonDisabledReason,
  doneActionLabel,
  onDoneAction,
  onToggleExpand,
  onUpdateConfig,
  onRemove,
  onReset,
  onDismissError,
  onDoubleClickCard,
  beforeContent,
  afterContent,
  loadingContent,
  keepContentMountedWhenCollapsed = false,
  dimmed = false,
  variants,
  showVariantsPreGen = false,
  showVariantsPostGen = false,
  showSettingsSummary = true,
  description,
}: CardProps<TConfig>) {
  // Compute default name if not provided
  const computedDefaultName = defaultName || getCardDefaultName(config, index);
  const baseName = config.display_name || computedDefaultName;
  const displayName = showIndex ? `${index + 1}. ${baseName}` : baseName;

  // Card info popover text — per-card override falls back to the type description.
  const cardDescription = description ?? CARD_TYPE_DESCRIPTIONS[config.type];

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

  // Whole shell turns solid blue once a result exists (and no error) — signals
  // "generated" without needing the separate accent strip.
  const isGenerated = hasResult && !error;

  // Build Tailwind class names
  const cardClassName = [
    'relative border rounded-xl transition-all duration-200',
    isGenerated ? 'card-generated' : 'bg-surface',
    error ? 'border-error' : 'border-border',
  ].filter(Boolean).join(' ');

  const titleClassName = [
    `flex-1 text-left text-xs font-sans font-medium transition-opacity group`,
    isGenerated ? 'text-on-blue' : 'text-foreground',
  ].filter(Boolean).join(' ');

  // Tracks the expansion state captured at the first click of a potential double-click sequence,
  // so we can restore the original state when the second click fires.
  const stateAtFirstClickRef = useRef<boolean | null>(null);

  // Right-click context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [expandedSubKey, setExpandedSubKey] = useState<string | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => { setContextMenu(null); setExpandedSubKey(null); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [contextMenu]);

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

  // Right-click on the card → show context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setExpandedSubKey(null);
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // Render content based on state
  // Note: Error display is handled at the Card level (shown before content)
  // to keep all configuration visible when errors occur.
  const renderContent = () => {
    if (isRunning && loadingContent) {
      return (
        <div className="flex items-center justify-center p-4 text-secondary-hover text-xs">
          {loadingContent}
        </div>
      );
    }

    if (hasResult && afterContent) {
      return afterContent;
    }

    return beforeContent;
  };

  // Variants bar — shown in the pre-gen or post-gen state depending on the
  // corresponding toggle. Card owns the state-awareness (hasResult); the parent
  // owns the data + callbacks.
  const showVariantsBar = !!variants && (hasResult ? showVariantsPostGen : showVariantsPreGen);
  const versionTitle = Array.isArray(version) ? version.join(' · ') : version;

  // Unified run/stop/progress state for the bottom bar — derived entirely from
  // existing store-driven props (no local state / AbortController).
  const generateStatus: GenerateStatus = isRunning
    ? 'generating'
    : hasResult
      ? 'done'
      : 'idle';

  return (
    <div
      className={cardClassName}
      onDoubleClick={handleCardDoubleClick}
      onContextMenu={handleContextMenu}
      style={{
        ...cardColorStyle,
        ...(isGenerated ? { backgroundColor: 'color-mix(in srgb, var(--color-primary) 72%, var(--color-surface))' } : {}),
        ...(error ? { borderColor: `var(--color-error)` } : {}),
        ...(dimmed ? { filter: 'brightness(0.55)' } : {}),
      }}
    >
      {/* Accent strip — thin colored bar on the card's left edge. Once generated,
          the whole shell is solid blue and the strip would blend into itself,
          so it's now reserved for the error state only. */}
      {error && (
        <div
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-[3px]"
          style={{
            backgroundColor: error ? 'var(--color-error)' : 'var(--card-color)',
            borderTopLeftRadius: '12px',
            borderBottomLeftRadius: '12px',
          }}
        />
      )}

      {/* Header - Click to expand/collapse.
           Double-click to zoom — stops propagation so the outer card's onDoubleClick doesn't fire twice. */}
      <div
        className="group relative z-10 flex items-center justify-between gap-2 cursor-pointer px-3 pt-1.5 pb-1.5"
        onClick={!isEditingName ? handleToggleClick : undefined}
        onDoubleClick={e => e.stopPropagation()}
        style={{ userSelect: 'none' }}
      >
        {/* Header prefix slot — e.g., entity link button */}
        {headerPrefix && (
          <div className="flex-shrink-0" onClick={e => e.stopPropagation()}>
            {headerPrefix}
          </div>
        )}

        {/* Title + pen */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
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
                <div
                  className={`text-xxs mt-0.5 ${isGenerated ? '' : 'text-info'}`}
                  style={isGenerated ? { color: 'var(--color-on-blue)' } : undefined}
                >
                  {collapsedInfo}
                </div>
              )}
              {!isExpanded && isPlayingCollapsedInfo && (
                <div className="text-xxs mt-0.5 italic text-warning">
                  playing
                </div>
              )}
              {isExpanded && version && (
                <div className="mt-1 flex items-center gap-1 min-w-0">
                  <div
                    className={`text-[10px] font-mono leading-tight min-w-0 overflow-hidden text-ellipsis whitespace-nowrap ${isGenerated ? 'text-on-blue-muted' : 'text-text-3'}`}
                    title={versionTitle}
                  >
                    {versionTitle}
                  </div>
                  {/* Info ("i") popover — at the end of the version text, no gap, shown
                      only while expanded and only on cards that expose a version. */}
                  <InfoPopover
                    title={CARD_TYPE_LABELS[config.type]}
                    text={cardDescription}
                    label={`Info: ${CARD_TYPE_LABELS[config.type]}`}
                    compact
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Action buttons — collapse out of flow until title-bar hover/focus so the
            title can use the full bar; when they appear the title truncates to fit.
            self-start keeps them aligned with the title row (higher) instead of
            centered against the taller title+version block. */}
        <div className="flex items-center gap-1 flex-shrink-0 w-0 overflow-hidden opacity-0 pointer-events-none self-start group-hover:w-auto group-hover:opacity-100 group-hover:pointer-events-auto focus-within:w-auto focus-within:opacity-100 focus-within:pointer-events-auto">
          {/* Reset button - only show if result exists */}
          {hasResult && (
            <CardButton
              icon={<ResetIcon />}
              title={resetButtonTitle}
              onClick={handleResetClick}
              variant="default"
              onBlueBackground={isGenerated}
            />
          )}

          {/* Close button */}
          {canRemove && (
            <CardButton
              icon={<CloseIcon />}
              title={closeButtonTitle}
              onClick={handleRemoveClick}
              variant="close"
              onBlueBackground={isGenerated}
            />
          )}
        </div>
      </div>

      {/* Expanded content — kept mounted (hidden) instead of unmounted when
          `keepContentMountedWhenCollapsed` is set, so content that owns a live
          resource (e.g. a playing WaveSurfer instance) survives collapse/expand
          without being destroyed and recreated. */}
      {(isExpanded || keepContentMountedWhenCollapsed) && (
        <div
          className="px-1 space-y-0 max-h-[min(480px,55dvh)] overflow-y-auto pr-0.5 relative z-[1]"
          style={!isExpanded ? { display: 'none' } : undefined}
        >

          {renderContent()}

          {/* Variants bar — letter-square selector (pre-gen speech lines / post-gen audio variants) */}
          {showVariantsBar && variants && (
            <VariantsBar {...variants} onBlueBackground={isGenerated} />
          )}
                    
          {/* Error display - shown before content but keeps configuration visible */}
          {error && (
            <Notice
              type="error"
              variant="bar"
              message={error}
              onDismiss={onDismissError ? () => onDismissError(index) : undefined}
            />
          )}

          {/* Read-only recap of the pre-generation settings for generated cards */}
          {showSettingsSummary && hasResult && (
            <SettingsSummary title={getSettingsTitle(config)} rows={getSettingsRows(config)} />
          )}
        </div>
      )}

      {/* Bottom bar — unified run / stop / progress UI. Always visible while
          generating (both expanded and reduced states); idle/done actions only
          show when the card is expanded (nothing actionable in reduced state). */}
      {(generateStatus === 'generating' ||
        (isExpanded && generateStatus === 'idle' && !!onRun) ||
        (isExpanded && generateStatus === 'done' && !!doneActionLabel && !!onDoneAction)) && (
        <div
          className="px-3.5 py-1.5 border-border"
          style={isGenerated && generateStatus === 'done' ? {
            backgroundColor: 'rgba(0, 0, 0, 0.15)',
            borderBottomLeftRadius: '12px',
            borderBottomRightRadius: '12px',
          } : undefined}
        >
          <GenerateButton
            status={generateStatus}
            progress={progress}
            statusText={status}
            label={actionButtonLabel}
            disabled={actionButtonDisabled}
            disabledReason={actionButtonDisabledReason}
            onGenerate={onRun}
            onStop={onCancel}
            doneLabel={doneActionLabel}
            onDoneAction={onDoneAction}
          />
        </div>
      )}

      {/* Right-click context menu — rendered via portal to <body> so it escapes the
          card's stacking context. Dimmed (muted) cards apply `filter: brightness(...)`,
          which creates a new stacking context and would trap z-index:9999 behind other cards. */}
      {contextMenu && createPortal(
        <div
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            zIndex: 9999,
            backgroundColor: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-strong)',
            borderRadius: '8px',
            boxShadow: 'var(--shadow-lg)',
            minWidth: '150px',
            padding: '4px 0',
            fontSize: '11px',
          }}
        >
          {/* Rename option */}
          {!isEditingName && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setContextMenu(null);
                startEdit();
              }}
              className="flex items-center gap-2 w-full text-left px-3 py-2 text-xs text-foreground cursor-pointer hover:bg-secondary-light transition-colors"
            >
              <span className="flex-shrink-0 w-3 h-3 flex items-center justify-center">
                <PenIcon />
              </span>
              <span className="flex-1">Rename</span>
            </button>
          )}

          {/* Custom buttons */}
          {customButtons && customButtons.map(item => (
            <div key={item.key}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.disabled) return;
                  if (item.subItems) {
                    setExpandedSubKey(prev => prev === item.key ? null : item.key);
                  } else {
                    item.onClick?.(e);
                    setContextMenu(null);
                  }
                }}
                disabled={item.disabled && !item.subItems}
                className={`flex items-center gap-2 w-full text-left px-3 py-2 text-xs transition-colors ${
                  item.disabled && !item.subItems
                    ? 'opacity-40 cursor-not-allowed text-secondary-hover'
                    : item.isActive
                      ? 'cursor-pointer'
                      : 'text-foreground cursor-pointer hover:bg-secondary-light'
                }`}
                style={item.isActive ? {
                  backgroundColor: 'var(--card-color-lighter, var(--color-primary-light))',
                  color: 'var(--card-color, var(--color-primary))',
                } : undefined}
              >
                <span className="flex-shrink-0 w-3 h-3 flex items-center justify-center">
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.subItems && (
                  <span className="text-secondary-hover text-[10px]">
                    {expandedSubKey === item.key ? '▾' : '▸'}
                  </span>
                )}
              </button>

              {/* Sub-items accordion */}
              {item.subItems && expandedSubKey === item.key && (
                <div className="border-t border-secondary-light">
                  {item.subItems.map(sub => (
                    <button
                      key={sub.key}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!sub.disabled) {
                          sub.onClick(e);
                          setContextMenu(null);
                          setExpandedSubKey(null);
                        }
                      }}
                      disabled={sub.disabled}
                      className={`flex items-center gap-2 w-full text-left pl-8 pr-3 py-2 text-xs transition-colors ${
                        sub.disabled
                          ? 'opacity-40 cursor-not-allowed text-secondary-hover'
                          : sub.isActive
                            ? 'cursor-pointer'
                            : 'text-foreground cursor-pointer hover:bg-secondary-light'
                      }`}
                      style={sub.isActive ? {
                        backgroundColor: 'var(--card-color-lighter, var(--color-primary-light))',
                        color: 'var(--card-color, var(--color-primary))',
                      } : undefined}
                    >
                      <span className="flex-1">{sub.label}</span>
                      {sub.isActive && (
                        <span className="text-[10px] opacity-60">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>,
        document.body
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
  /** Recolors the icon for legibility on a solid-blue generated card. */
  onBlueBackground?: boolean;
}

export function CardButton({ icon, title, onClick, disabled = false, variant = 'default', onBlueBackground = false }: CardButtonProps) {
  const variantClasses = {
    default: 'text-secondary-hover hover:bg-secondary-light hover:text-foreground',
    close: 'text-secondary-hover hover:bg-error-light hover:text-error',
    primary: 'text-primary hover:bg-primary-light hover:text-primary',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${
        onBlueBackground ? `on-blue-btn ${variant === 'close' ? 'close' : ''}` : variantClasses[variant]
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
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

