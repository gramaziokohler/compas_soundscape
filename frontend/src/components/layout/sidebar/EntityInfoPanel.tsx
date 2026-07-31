'use client';

import { useMemo, useState, useCallback } from 'react';
import { getAnalysisGroupColor } from '@/utils/utils';
import { useSpeckleStore, getAnalysisResultGroups } from '@/store';
import { useAudioControlsStore } from '@/store';
import { useAnalysisStore } from '@/store';
import { SoundResultContent } from '@/components/layout/sidebar/sound/SoundResultContent';
import { VariantsBar } from '@/components/ui/VariantsBar';
import type { SoundEvent } from '@/types';

// ============================================================================
// Component
// ============================================================================

/**
 * EntityInfoPanel Component
 *
 * Embedded version of EntityInfoBox for display in RightSidebar / right-click menu.
 * Modes:
 * - Receiver: receiver details with go-to button
 * - Sound: sound result/preview controls
 * - Default: entity information + analysis group controls
 *
 * NOTE: Acoustic material/scattering assignment has moved to the Object Explorer
 * (two extra columns shown while a Pyroom/Choras card is active).
 */

interface EntityInfoPanelProps {
  onGoToReceiver?: (receiverId: string) => void;
  /** Still passed from parent — SoundEvent list owned by useSoundGeneration (not yet migrated). */
  generatedSounds?: SoundEvent[];
}

export function EntityInfoPanel({
  onGoToReceiver,
  generatedSounds,
}: EntityInfoPanelProps) {
  const { selectedEntity } = useSpeckleStore();

  // ── Audio controls store ──
  const selectedVariants = useAudioControlsStore((s) => s.selectedVariants);
  const soundVolumes = useAudioControlsStore((s) => s.soundVolumes);
  const soundIntervals = useAudioControlsStore((s) => s.soundIntervals);
  const mutedSounds = useAudioControlsStore((s) => s.mutedSounds);
  const onVolumeChange = useAudioControlsStore((s) => s.handleVolumeChange);
  const onIntervalChange = useAudioControlsStore((s) => s.handleIntervalChange);
  const onVariantChange = useAudioControlsStore((s) => s.handleVariantChange);

  // Local independent playback state for the EntityInfoPanel sound player
  const [localPreviewId, setLocalPreviewId] = useState<string | null>(null);

  const handleLocalPlayPause = useCallback((soundId: string) => {
    setLocalPreviewId(prev => prev === soundId ? null : soundId);
  }, []);

  const handleLocalStop = useCallback((soundId: string) => {
    setLocalPreviewId(prev => prev === soundId ? null : prev);
  }, []);

  // ===== RECEIVER INFORMATION MODE =====
  if (selectedEntity?.objectType === 'Receiver' && selectedEntity.receiverData) {
    const receiverColor = 'var(--color-receiver)';
    return (
      <div className="flex flex-col gap-2 text-xs">
        {/* ID row + go-to button */}
        <div className="flex items-center justify-between text-secondary">
          <div className="flex items-center gap-1 min-w-0">
            <span className="flex-shrink-0">ID:</span>
            <span className="mx-1 truncate" title={selectedEntity.objectId}>
              {selectedEntity.objectId}
            </span>
          </div>
          {onGoToReceiver && (
            <button
              onClick={() => onGoToReceiver(selectedEntity.objectId)}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'white';
                e.currentTarget.style.backgroundColor = receiverColor;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = receiverColor;
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded transition-colors"
              style={{ color: receiverColor, borderRadius: '6px' }}
              title="Go to receiver (first-person view)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }

  // ===== SOUND INFORMATION MODE =====
  if (selectedEntity?.objectType === 'Sound' && selectedEntity.soundData && generatedSounds) {
    const { promptIndex } = selectedEntity.soundData;
    const variants = generatedSounds.filter(s => s.prompt_index === promptIndex);

    if (variants.length > 0) {
      const selectedVariantIdx = selectedVariants?.[promptIndex] ?? 0;
      const generatedSound = variants[selectedVariantIdx] || variants[0];
      const isMuted = mutedSounds?.has(generatedSound.id) ?? false;

      return (
        <div className="flex flex-col gap-2 min-w-0">
          <SoundResultContent
            generatedSound={generatedSound}
            index={promptIndex}
            variants={variants}
            selectedVariantIdx={selectedVariantIdx}
            isPreviewPlaying={localPreviewId === generatedSound.id}
            isMuted={isMuted}
            soundVolumes={soundVolumes ?? {}}
            soundIntervals={soundIntervals ?? {}}
            onPreviewPlayPause={handleLocalPlayPause}
            onPreviewStop={handleLocalStop}
            onVolumeChange={onVolumeChange}
            onIntervalChange={onIntervalChange}
          />
          <VariantsBar
            items={variants.map((v, i) => ({ key: v.id, title: String.fromCharCode(65 + i) }))}
            selectedIndex={selectedVariantIdx}
            onSelect={onVariantChange ? (i) => onVariantChange(promptIndex, i) : undefined}
          />
        </div>
      );
    }
  }

  // ===== DEFAULT: ENTITY INFORMATION MODE =====

  // If no entity selected, show placeholder
  if (!selectedEntity) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-12 w-12 mb-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          style={{ color: 'var(--color-secondary-hover)' }}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
          />
        </svg>
        <p className="text-sm" style={{ color: 'var(--color-secondary-hover)' }}>
          Click on an object in the 3D view to see its details
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">

      {/* Analysis Group Information */}
      <AnalysisGroupSection objectId={selectedEntity.objectId} />

      {/* Entity Details */}
      <div className="space-y-1 text-xs flex-1 overflow-y-auto">
        <div className="flex text-secondary">
          <span>Type:</span>
          <span className="mx-2">{selectedEntity.objectType}</span>
        </div>

        {selectedEntity.objectName && (
          <div className="flex text-secondary">
            <span>Name:</span>
            <span
              className="text-right mx-2 max-w-[180px] truncate"
              title={selectedEntity.objectName}
            >
              {selectedEntity.objectName}
            </span>
          </div>
        )}

        {selectedEntity.parentName && (
          <div className="flex text-secondary">
            <span>Parent:</span>
            <span
              className="text mx-2 max-w-[180px] truncate"
              title={selectedEntity.parentName}
            >
              {selectedEntity.parentName}
            </span>
          </div>
        )}

        {selectedEntity.objectId && (
          <div className="flex text-secondary">
            <span>Object ID:</span>
            <span
              className="text-right mx-2 max-w-[160px] truncate"
              title={selectedEntity.objectId}
            >
              {selectedEntity.objectId}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AnalysisGroupSection ─────────────────────────────────────────────────────

/**
 * Inline component shown in EntityInfoPanel when the selected object belongs
 * to a model-analysis group. Supports inline editing of name/description/material.
 */
function AnalysisGroupSection({ objectId }: { objectId: string }) {
  // Subscribe to analysisObjectGroups for reactivity when groups change
  const analysisObjectGroups = useSpeckleStore((s) => s.analysisObjectGroups);

  const matchedGroup = useMemo(() => {
    const groups = getAnalysisResultGroups();
    const idx = groups.findIndex((g) => g.object_ids != null && objectId in g.object_ids);
    if (idx === -1) return null;
    return { group: groups[idx], index: idx };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectId, analysisObjectGroups]);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editMaterial, setEditMaterial] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  if (!matchedGroup) return null;

  const { group, index } = matchedGroup;
  const color = getAnalysisGroupColor(index);

  const handleEditStart = () => {
    setEditName(group.name);
    setEditDescription(group.description ?? '');
    setEditMaterial(group.material ?? '');
    setIsEditing(true);
  };

  const handleSave = async () => {
    // Find configIndex by searching analysisConfigs for a model-analysis config with this group
    const { analysisConfigs, handleUpdateAnalysisObject } = useAnalysisStore.getState();
    const configIdx = analysisConfigs.findIndex(
      (c) =>
        c.type === 'model-analysis' &&
        (c as any).analysisResult?.architecturalObjects?.[index] !== undefined,
    );
    if (configIdx === -1) return;
    setIsSaving(true);
    try {
      await handleUpdateAnalysisObject(configIdx, index, {
        name: editName,
        description: editDescription,
        material: editMaterial,
      });
    } finally {
      setIsSaving(false);
      setIsEditing(false);
    }
  };

  return (
    <div
      className="pt-2 mt-2 space-y-1"
      style={{ borderTop: `1px solid var(--color-secondary-light)`, borderLeft: `3px solid ${color}`, paddingLeft: 8 }}
    >
      {!isEditing ? (
        <>
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-success)' }}>
              Analysis Group
            </span>
            <button
              onClick={handleEditStart}
              className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full text-secondary-hover opacity-80 hover:opacity-100 hover:bg-secondary-light hover:text-foreground transition-all cursor-pointer"
              style={{ color: 'var(--color-secondary-hover)', cursor: 'pointer' }}
              title="Edit group info"
            >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H8v-2.414a2 2 0 01.586-1.414z" />
            </svg>
            </button>
          </div>
          <div
            className="flex items-center gap-1.5 flex-wrap"
            title={group.description || undefined}
          >
            <span className="text-xs font-medium" style={{ color: 'var(--color-foreground)' }}>
              {group.name}
            </span>
          </div>
          {group.description && (
            <p className="text-xs leading-tight" style={{ color: 'var(--color-secondary-hover)' }}>
              {group.description}
            </p>
          )}
          {group.material && (
            <span
              className="inline-block text-xs px-1 rounded"
              style={{ backgroundColor: 'var(--color-secondary-light)', color: 'var(--color-secondary-hover)' }}
            >
              {group.material}
            </span>
          )}
        </>
      ) : (
        <>
          <div className="text-xs font-medium" style={{ color: 'var(--color-success)' }}>
            Edit Group
          </div>
          <input
            className="w-full text-xs rounded px-2 py-1"
            style={{
              backgroundColor: 'var(--color-secondary-lighter)',
              color: 'var(--color-foreground)',
              border: '1px solid var(--color-secondary-light)',
            }}
            placeholder="Name"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
          />
          <input
            className="w-full text-xs rounded px-2 py-1"
            style={{
              backgroundColor: 'var(--color-secondary-lighter)',
              color: 'var(--color-foreground)',
              border: '1px solid var(--color-secondary-light)',
            }}
            placeholder="Description"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
          />
          <input
            className="w-full text-xs rounded px-2 py-1"
            style={{
              backgroundColor: 'var(--color-secondary-lighter)',
              color: 'var(--color-foreground)',
              border: '1px solid var(--color-secondary-light)',
            }}
            placeholder="Material"
            value={editMaterial}
            onChange={(e) => setEditMaterial(e.target.value)}
          />
          <div className="flex gap-1.5">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 text-xs py-1 rounded"
              style={{
                backgroundColor: 'var(--color-success)',
                color: 'var(--color-background)',
                opacity: isSaving ? 0.6 : 1,
                cursor: isSaving ? 'wait' : 'pointer',
              }}
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="flex-1 text-xs py-1 rounded"
              style={{
                backgroundColor: 'var(--color-secondary-lighter)',
                color: 'var(--color-secondary-hover)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
