'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSceneWorkflowStore, useUIStore, notifyError } from '@/store';
import { useSoundScenes } from '@/hooks/useSoundScenes';
import { useWorkspaceModelEntries, type WorkspaceModelEntry } from '@/hooks/useWorkspaceModelEntries';
import { useSendScenesToModel } from '@/hooks/useSendScenesToModel';
import { buildSpeckleSelectPayload, formatRelativeTime, type SpeckleSelectData } from '@/components/scene/modelBrowserShared';
import { Checkbox } from '@/components/ui/Checkbox';
import { Spinner } from '@/components/ui/Spinner';
import { Notice } from '@/components/ui/Notice';
import { SANDBOX_MODEL_ID, SCENE_TRANSFER, UI_BORDER_RADIUS } from '@/utils/constants';
import type { SendScenesResponse, SendTargetEntry } from '@/types/sceneTransfer';

interface SendScenesModalProps {
  open: boolean;
  /** Id of the open model / Homepage project (the source). */
  sourceModelId: string | null;
  /** The source is a Homepage project (same sandbox room as other Homepage projects). */
  sourceIsHome: boolean;
  /** Save the open model; resolves false when the save failed. */
  flushSave: () => Promise<boolean>;
  onClose: () => void;
  /** "Open model" toast action for a Speckle target. */
  onOpenSpeckleModel: (speckleData: SpeckleSelectData) => void;
  /** "Open model" toast action for a Homepage project target. */
  onOpenHomeProject: (modelId: string) => void;
}

const BUTTON_BASE = 'py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40';
const PRIMARY_BUTTON_STYLE: React.CSSProperties = {
  background: 'var(--color-primary)',
  color: 'var(--color-on-blue)',
  borderRadius: `${UI_BORDER_RADIUS.SM}px`,
};
const SECONDARY_BUTTON_STYLE: React.CSSProperties = {
  background: 'var(--color-secondary-lighter)',
  color: 'var(--foreground)',
  borderRadius: `${UI_BORDER_RADIUS.SM}px`,
};
const LIST_STYLE: React.CSSProperties = {
  maxHeight: SCENE_TRANSFER.LIST_MAX_HEIGHT_PX,
  overflowY: 'auto',
  border: '1px solid var(--color-overlay-border)',
  borderRadius: `${UI_BORDER_RADIUS.SM}px`,
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function toTarget(entry: WorkspaceModelEntry, projectId: string): SendTargetEntry {
  return entry.kind === 'home'
    ? { modelId: entry.project.model_id, name: entry.project.name, isHome: true, savedAt: entry.project.saved_at }
    : {
        modelId: entry.model.id,
        name: entry.model.display_name,
        isHome: false,
        projectId,
        versionId: entry.model.latest_version?.id,
        savedAt: entry.model.last_saved_at,
      };
}

/** One selectable row (checkbox for scenes, radio dot for the target). */
function SelectRow({
  selected,
  disabled = false,
  control,
  title,
  hint,
  onToggle,
}: {
  selected: boolean;
  disabled?: boolean;
  control: 'checkbox' | 'radio';
  title: string;
  hint?: string;
  onToggle: () => void;
}) {
  return (
    <div
      role={control === 'radio' ? 'radio' : undefined}
      aria-checked={control === 'radio' ? selected : undefined}
      aria-disabled={disabled}
      tabIndex={control === 'radio' && !disabled ? 0 : undefined}
      onClick={() => { if (!disabled) onToggle(); }}
      onKeyDown={(e) => {
        if (!disabled && control === 'radio' && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onToggle();
        }
      }}
      className="flex items-center gap-2 px-2 py-1.5 transition-colors hover:bg-secondary-lighter"
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        background: selected && control === 'radio' ? 'var(--color-primary-lighter)' : undefined,
      }}
    >
      {control === 'checkbox' ? (
        <Checkbox checked={selected} disabled={disabled} onChange={onToggle} label={title} size={14} />
      ) : (
        <span
          aria-hidden="true"
          className="shrink-0 rounded-full"
          style={{
            width: 12,
            height: 12,
            border: `1px solid ${selected ? 'var(--color-primary)' : 'var(--color-border-strong)'}`,
            boxShadow: selected ? 'inset 0 0 0 3px var(--color-primary)' : undefined,
          }}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-foreground truncate" title={title}>{title}</span>
        {hint && <span className="block text-[11px] text-secondary-hover truncate">{hint}</span>}
      </span>
    </div>
  );
}

function SendScenesDialog({
  sourceModelId,
  sourceIsHome,
  flushSave,
  onClose,
  onOpenSpeckleModel,
  onOpenHomeProject,
}: Omit<SendScenesModalProps, 'open'>) {
  const scenes = useSoundScenes();
  const runs = useSceneWorkflowStore((s) => s.runs);
  const { entries, projectId, authToken, isLoading, error: listError } = useWorkspaceModelEntries(true);
  const { send, isSending, error: sendError } = useSendScenesToModel({ sourceModelId, flushSave });

  const isRunning = (usageIndex: number) => runs[usageIndex]?.status === 'running';

  // Preselect the scene that is shown (powered) right now, if it can be sent.
  const [selectedScenes, setSelectedScenes] = useState<Set<number>>(() => {
    const active = useUIStore.getState().activeSoundParentIndex;
    const initial = new Set<number>();
    if (active !== null && scenes.some((s) => s.usageIndex === active) && !isRunning(active)) initial.add(active);
    return initial;
  });
  const [targetId, setTargetId] = useState<string | null>(null);
  const [keepPositions, setKeepPositions] = useState(false);

  const targetEntries = useMemo(
    () =>
      entries.filter((e) => {
        const id = e.kind === 'home' ? e.project.model_id : e.model.id;
        return id !== sourceModelId && id !== SANDBOX_MODEL_ID;
      }),
    [entries, sourceModelId],
  );
  const targets = useMemo(() => targetEntries.map((e) => toTarget(e, projectId)), [targetEntries, projectId]);
  const target = targets.find((t) => t.modelId === targetId) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, isSending]);

  const toggleScene = (usageIndex: number) =>
    setSelectedScenes((prev) => {
      const next = new Set(prev);
      if (next.has(usageIndex)) next.delete(usageIndex);
      else next.add(usageIndex);
      return next;
    });

  const selectTarget = (t: SendTargetEntry) => {
    setTargetId(t.modelId);
    // Two Homepage projects share the same sandbox room, so positions still fit.
    setKeepPositions(sourceIsHome && t.isHome);
  };

  const openTarget = (t: SendTargetEntry) => {
    if (t.isHome) {
      onOpenHomeProject(t.modelId);
      return;
    }
    const entry = targetEntries.find((e) => e.kind === 'speckle' && e.model.id === t.modelId);
    const payload = entry?.kind === 'speckle' ? buildSpeckleSelectPayload(entry.model, projectId, authToken) : null;
    if (payload) onOpenSpeckleModel(payload);
  };

  const notifySent = (t: SendTargetEntry, result: SendScenesResponse) => {
    const missing = result.missing_audio_filenames.length;
    const message =
      `Sent ${plural(result.scenes_sent, 'scene')} (${plural(result.sounds_sent, 'sound')}) to “${t.name}”.` +
      (missing > 0 ? ` ${plural(missing, 'audio file')} could not be found and were skipped.` : '');
    notifyError(message, missing > 0 ? 'warning' : 'info', { label: SCENE_TRANSFER.OPEN_MODEL, onClick: () => openTarget(t) });
  };

  const handleSend = async () => {
    if (!target) return;
    const usageIndices = scenes.map((s) => s.usageIndex).filter((u) => selectedScenes.has(u) && !isRunning(u));
    const result = await send(target, usageIndices, keepPositions);
    if (!result) return;
    notifySent(target, result);
    onClose();
  };

  const sendable = scenes.some((s) => selectedScenes.has(s.usageIndex) && !isRunning(s.usageIndex));
  const canSend = sendable && !!target && !isSending;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={SCENE_TRANSFER.TITLE}
      className="absolute inset-0 z-50 flex items-center justify-center pointer-events-auto"
      style={{ backgroundColor: 'color-mix(in srgb, var(--background) 62%, transparent)' }}
      onClick={() => { if (!isSending) onClose(); }}
    >
      <div
        className="frosted-surface backdrop-blur-lg backdrop-saturate-150 shadow-lg flex flex-col gap-3"
        style={{
          width: 'min(92vw, 26rem)',
          border: '1px solid var(--color-overlay-border)',
          borderRadius: `${UI_BORDER_RADIUS.MD}px`,
          background: 'var(--color-overlay-bg)',
          padding: 14,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-foreground">{SCENE_TRANSFER.TITLE}</p>

        <div>
          <p className="text-[11px] font-medium text-secondary-hover mb-1">{SCENE_TRANSFER.SCENES_LABEL}</p>
          <div style={LIST_STYLE}>
            {scenes.map((scene) => {
              const running = isRunning(scene.usageIndex);
              return (
                <SelectRow
                  key={scene.usageIndex}
                  control="checkbox"
                  selected={selectedScenes.has(scene.usageIndex) && !running}
                  disabled={running || isSending}
                  title={scene.title}
                  hint={running ? SCENE_TRANSFER.STILL_GENERATING : plural(scene.soundCount, 'sound')}
                  onToggle={() => toggleScene(scene.usageIndex)}
                />
              );
            })}
          </div>
        </div>

        <div>
          <p className="text-[11px] font-medium text-secondary-hover mb-1">{SCENE_TRANSFER.TARGET_LABEL}</p>
          <div role="radiogroup" aria-label={SCENE_TRANSFER.TARGET_LABEL} style={LIST_STYLE}>
            {isLoading && targets.length === 0 ? (
              <div className="flex items-center gap-2 px-2 py-2 text-xs text-secondary-hover">
                <Spinner size={12} /> Loading models…
              </div>
            ) : targets.length === 0 ? (
              <p className="px-2 py-2 text-xs text-secondary-hover">{SCENE_TRANSFER.NO_TARGETS}</p>
            ) : (
              targets.map((t) => (
                <SelectRow
                  key={t.modelId}
                  control="radio"
                  selected={t.modelId === targetId}
                  disabled={isSending}
                  title={t.name}
                  hint={[
                    t.isHome ? 'Homepage project' : null,
                    t.savedAt ? `saved ${formatRelativeTime(t.savedAt)}` : SCENE_TRANSFER.NO_SOUNDSCAPE_YET,
                  ].filter(Boolean).join(' · ')}
                  onToggle={() => selectTarget(t)}
                />
              ))
            )}
          </div>
          {listError && <div className="mt-1"><Notice type="error" message={listError} /></div>}
        </div>

        <div className="flex items-start gap-2">
          <Checkbox
            checked={keepPositions}
            disabled={isSending}
            onChange={setKeepPositions}
            label={SCENE_TRANSFER.KEEP_POSITIONS_LABEL}
            size={14}
            className="mt-0.5"
          />
          <div className="min-w-0">
            <p className="text-xs text-foreground">{SCENE_TRANSFER.KEEP_POSITIONS_LABEL}</p>
            <p className="text-[11px] text-secondary-hover">{SCENE_TRANSFER.KEEP_POSITIONS_HINT}</p>
          </div>
        </div>

        <p className="text-[11px] text-secondary-hover opacity-80">{SCENE_TRANSFER.FOOTNOTE}</p>
        {sendError && <Notice type="error" message={sendError} />}

        <div className="flex gap-2">
          <button
            type="button"
            disabled={!canSend}
            onClick={() => void handleSend()}
            className={`flex-1 ${BUTTON_BASE} inline-flex items-center justify-center gap-1.5`}
            style={PRIMARY_BUTTON_STYLE}
          >
            {isSending && <Spinner size={12} />}
            {isSending ? SCENE_TRANSFER.SENDING : SCENE_TRANSFER.SEND}
          </button>
          <button
            type="button"
            disabled={isSending}
            onClick={onClose}
            className={`flex-1 ${BUTTON_BASE}`}
            style={SECONDARY_BUTTON_STYLE}
          >
            {SCENE_TRANSFER.CANCEL}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * SendScenesModal
 *
 * Copies sound scenes of the open model into another model of the same
 * workspace (a Speckle project model — saved or not — or a Homepage project).
 * Opened from the model pill menu. The open model is saved first; the copies
 * lose their object links and are re-placed in front of the camera unless
 * "Keep sound positions" is on.
 *
 * Usage:
 * ```tsx
 * <SendScenesModal open={show} sourceModelId={id} sourceIsHome={false} flushSave={flush}
 *   onClose={close} onOpenSpeckleModel={openModel} onOpenHomeProject={openHome} />
 * ```
 */
export function SendScenesModal({ open, ...props }: SendScenesModalProps) {
  // Mount the dialog only while open, so the model lists load on open.
  if (!open) return null;
  return <SendScenesDialog {...props} />;
}
