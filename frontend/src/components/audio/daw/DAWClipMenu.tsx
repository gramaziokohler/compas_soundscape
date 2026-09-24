'use client';

import { useState } from 'react';

export interface DAWClipMenuVariant {
  id: string;
  label: string;
}

export interface DAWClipMenuEntity {
  id: string;
  displayNumber: number;
}

export interface DAWClipMenuProps {
  x: number;
  y: number;
  variants: DAWClipMenuVariant[];
  currentVariantIndex?: number;
  linkedEntities: DAWClipMenuEntity[];
  currentEntityNodeId?: string;
  triggerExpression?: string | null;
  onPickVariant: (variantIndex: number) => void;
  onPickEntity: (entityId: string, entityIndex: number | undefined) => void;
  /** Fill every iteration of this track with the currently active variant. */
  onApplyVariantToAll: () => void;
  /** Fill every iteration of this track with the currently linked entity. */
  onApplyEntityToAll: () => void;
  onClose: () => void;
}

const MENU_WIDTH = 150;

/**
 * Right-click context menu for a DAW clip: variant override + linked-entity
 * override for the clicked iteration, plus bulk actions that fill every
 * iteration of the track with the currently active variant / linked entity.
 */
export function DAWClipMenu({
  x,
  y,
  variants,
  currentVariantIndex,
  linkedEntities,
  currentEntityNodeId,
  triggerExpression,
  onPickVariant,
  onPickEntity,
  onApplyVariantToAll,
  onApplyEntityToAll,
  onClose,
}: DAWClipMenuProps) {
  const [submenuOpen, setSubmenuOpen] = useState<'variants' | 'entities' | null>(null);
  const activeVariantLabel = String.fromCharCode(65 + (currentVariantIndex ?? 0));
  const showApplyVariant = variants.length > 1;
  const showApplyEntity = !!currentEntityNodeId;

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onMouseLeave={onClose}
      style={{
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        zIndex: 9999,
        backgroundColor: 'var(--background)',
        border: '1px solid var(--color-border-strong)',
        borderRadius: '6px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        width: `${MENU_WIDTH}px`,
        padding: '4px 0',
        fontSize: '11px',
      }}
    >
      {variants.length > 1 && (
        <div
          style={{
            padding: '6px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', color: 'var(--foreground)', position: 'relative',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-border)'; setSubmenuOpen('variants'); }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          <span>Variants</span>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
          {submenuOpen === 'variants' && (
            <div
              style={{
                position: 'absolute', left: `${MENU_WIDTH - 2}px`, top: 0, width: 80,
                backgroundColor: 'var(--background)', border: '1px solid var(--color-border-strong)',
                borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.5)', padding: '4px 0', zIndex: 10000,
              }}
            >
              {variants.map((v, vi) => {
                const isActive = currentVariantIndex === vi;
                return (
                  <div
                    key={v.id}
                    style={{ padding: '5px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--foreground)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-border)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    onClick={() => { onPickVariant(vi); onClose(); }}
                  >
                    <span style={{ width: 10, flexShrink: 0, color: 'var(--color-primary)', fontSize: '10px' }}>{isActive ? '✓' : ''}</span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '11px' }}>{v.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {triggerExpression && (
        <div
          style={{
            padding: '6px 12px', color: 'var(--color-secondary-hover)', fontSize: '10px', fontFamily: 'monospace',
            borderBottom: '1px solid var(--color-border)', cursor: 'default', display: 'flex', alignItems: 'center', gap: '4px',
          }}
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, opacity: 0.5 }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{triggerExpression}</span>
        </div>
      )}

      {variants.length <= 1 && linkedEntities.length === 0 && (
        <div style={{ padding: '8px 12px', color: 'var(--color-text-3)', fontStyle: 'italic', cursor: 'default', textAlign: 'center' }}>
          No variants or linked objects
        </div>
      )}

      {linkedEntities.length > 0 && (
        <div
          style={{
            padding: '6px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', color: 'var(--foreground)', position: 'relative',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-border)'; setSubmenuOpen('entities'); }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          <span>Linked entities</span>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
          {submenuOpen === 'entities' && (
            <div
              style={{
                position: 'absolute', left: `${MENU_WIDTH - 2}px`, top: 0, width: 80,
                backgroundColor: 'var(--background)', border: '1px solid var(--color-border-strong)',
                borderRadius: '6px', boxShadow: '0 4px 16px rgba(0,0,0,0.5)', padding: '4px 0', zIndex: 10000,
              }}
            >
              {linkedEntities.map((entity) => {
                const isActive = currentEntityNodeId === entity.id;
                return (
                  <div
                    key={entity.id}
                    style={{ padding: '5px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--foreground)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-border)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    onClick={() => { onPickEntity(entity.id, entity.displayNumber - 1); onClose(); }}
                  >
                    <span style={{ width: 10, flexShrink: 0, color: 'var(--color-primary)', fontSize: '10px' }}>{isActive ? '✓' : ''}</span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '11px' }}>{entity.displayNumber}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {(showApplyVariant || showApplyEntity) && (
        <div style={{ borderTop: '1px solid var(--color-border)', marginTop: '4px', paddingTop: '4px' }}>
          {showApplyVariant && (
            <div
              style={{ padding: '6px 12px', cursor: 'pointer', color: 'var(--foreground)', whiteSpace: 'nowrap' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-border)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              onClick={() => { onApplyVariantToAll(); onClose(); }}
            >
              Apply variant {activeVariantLabel} to all iterations
            </div>
          )}
          {showApplyEntity && (
            <div
              style={{ padding: '6px 12px', cursor: 'pointer', color: 'var(--foreground)', whiteSpace: 'nowrap' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-border)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              onClick={() => { onApplyEntityToAll(); onClose(); }}
            >
              Apply linked object to all iterations
            </div>
          )}
        </div>
      )}
    </div>
  );
}
