'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useModelVersionStore, useAcousticsSimulationStore, useWorkspaceStore, selectIsReadOnlyWorkspace } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { formatRelativeTime } from '@/components/scene/modelBrowserShared';
import { Spinner } from '@/components/ui/Spinner';
import { MODEL_VERSION, SCENE_TRANSFER } from '@/utils/constants';
import { useSoundScenes } from '@/hooks/useSoundScenes';
import type { SpeckleModelVersion } from '@/types/speckle-models';
import { useModelPillInfo } from './useModelPillInfo';

export interface ModelVersionMenuProps {
  kind: 'model' | 'project';
  /** Distance from the viewport's right edge (aligns the menu with the pill). */
  anchorRight: number;
  name: string;
  /** Element whose clicks must not count as "outside" (the pill toggles itself). */
  ignoreRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onOpenModelBrowser: () => void;
  onUploadNewVersion: (file: File) => void;
  /** Open the "Send scenes to another model" dialog. */
  onSendScenes: () => void;
}

const ROW_ICON = 14;

/** "14m ago · A. Martin · "moved partition"" (or "uploaded <file>" when there is no message). */
function versionSubtitle(v: SpeckleModelVersion): string {
  const what = v.message ? `"${v.message}"` : v.file_name ? `uploaded ${v.file_name}` : null;
  return [v.created_at && formatRelativeTime(v.created_at), v.author_name, what].filter(Boolean).join(' · ');
}

/**
 * ModelVersionMenu
 *
 * Upward popover of the model pill: version history (the loaded one checked;
 * "latest" and simulation-count tags), "Upload new version…", "Send scenes to
 * another model…", "Open another model…" and "Open in Speckle". For a no-model
 * soundscape it offers to attach a model (and to send its scenes). Closes on
 * outside click or Escape.
 */
export function ModelVersionMenu({
  kind,
  anchorRight,
  name,
  ignoreRef,
  onClose,
  onOpenModelBrowser,
  onUploadNewVersion,
  onSendScenes,
}: ModelVersionMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showAll, setShowAll] = useState(false);
  const versions = useModelVersionStore((s) => s.versions);
  const versionsStatus = useModelVersionStore((s) => s.versionsStatus);
  const isUploadingVersion = useModelVersionStore((s) => s.isUploadingVersion);
  const loadedVersionId = useSpeckleEngineStore((s) => s.loadedModelVersionId);
  const simulationConfigs = useAcousticsSimulationStore((s) => s.simulationConfigs);
  const info = useModelPillInfo();
  const isReadOnly = useWorkspaceStore(selectIsReadOnlyWorkspace);
  const sceneCount = useSoundScenes().length;

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || ignoreRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, ignoreRef]);

  useEffect(() => {
    if (kind === 'model' && versionsStatus === 'idle') void useModelVersionStore.getState().fetchVersions();
  }, [kind, versionsStatus]);

  const simCountByVersion = new Map<string, number>();
  for (const c of simulationConfigs) {
    if (c.state === 'completed' && c.simulatedVersionId) {
      simCountByVersion.set(c.simulatedVersionId, (simCountByVersion.get(c.simulatedVersionId) ?? 0) + 1);
    }
  }

  const visible = showAll ? versions : versions.slice(0, MODEL_VERSION.MENU_VISIBLE_VERSIONS);
  const hiddenCount = versions.length - visible.length;
  const speckleUrl = info.projectId && useModelVersionStore.getState().modelId
    ? `${MODEL_VERSION.SPECKLE_APP_URL}/projects/${info.projectId}/models/${useModelVersionStore.getState().modelId}${loadedVersionId ? `@${loadedVersionId}` : ''}`
    : null;

  // Owner-only (it writes another model's soundscape); hidden for viewers.
  const sendScenesRow = !isReadOnly && (
    <button
      type="button"
      role="menuitem"
      className="mv-row"
      disabled={sceneCount === 0}
      onClick={() => { onSendScenes(); onClose(); }}
    >
      <MenuIcon d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
      <span className="min-w-0 flex-1">
        <span className="block">{SCENE_TRANSFER.MENU_LABEL}</span>
        <span className="mv-hint block">{sceneCount === 0 ? 'No sound scenes in this model yet' : SCENE_TRANSFER.MENU_HINT}</span>
      </span>
    </button>
  );

  const selectVersion = (v: SpeckleModelVersion) => {
    if (v.id !== loadedVersionId) useModelVersionStore.getState().switchToVersion(v.id, loadedVersionId);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="bar-popover mv-popover"
      role="menu"
      aria-label="Model menu"
      style={{ right: anchorRight, width: MODEL_VERSION.MENU_WIDTH_PX }}
    >
      <div className="flex items-center gap-2" style={{ padding: '9px 11px' }}>
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate" title={name}>{name}</p>
          <p className="mv-hint truncate">
            {kind === 'model'
              ? [info.modelName && info.modelName !== name ? `Speckle model: ${info.modelName}` : null, `${versions.length} version${versions.length === 1 ? '' : 's'}`]
                  .filter(Boolean)
                  .join(' · ')
              : 'Soundscape without a model'}
          </p>
        </div>
      </div>

      {kind === 'model' && (
        <div className="mv-popover__section">
          <p className="mv-hint" style={{ margin: '0 0 4px 6px' }}>Versions</p>
          {versionsStatus === 'loading' && versions.length === 0 && (
            <div className="flex items-center gap-2 mv-muted" style={{ padding: '4px 6px' }}>
              <Spinner size={12} /> Loading versions…
            </div>
          )}
          {versionsStatus === 'error' && versions.length === 0 && (
            <button type="button" className="mv-row mv-muted" onClick={() => void useModelVersionStore.getState().fetchVersions()}>
              Couldn&apos;t load versions. Retry
            </button>
          )}
          <div style={{ maxHeight: showAll ? 260 : undefined, overflowY: showAll ? 'auto' : undefined }}>
            {visible.map((v) => {
              const current = v.id === loadedVersionId;
              const sims = simCountByVersion.get(v.id) ?? 0;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  className="mv-row"
                  data-current={current}
                  onClick={() => selectVersion(v)}
                >
                  <span style={{ width: ROW_ICON, flexShrink: 0, color: 'var(--color-blue-text)' }} aria-hidden="true">
                    {current && (
                      <svg width={ROW_ICON} height={ROW_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={current ? 'font-medium' : undefined}>v{v.number}</span>
                      {v.is_latest && <span className="mv-tag">latest</span>}
                      {sims > 0 && <span className="mv-tag mv-tag--neutral">{sims} sim{sims === 1 ? '' : 's'}</span>}
                    </span>
                    <span className="mv-hint block truncate">{versionSubtitle(v)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {hiddenCount > 0 && (
            <button type="button" className="mv-row mv-hint" onClick={() => setShowAll(true)}>
              <span style={{ width: ROW_ICON }} aria-hidden="true">▾</span>
              Show {hiddenCount} older version{hiddenCount === 1 ? '' : 's'}
            </button>
          )}
        </div>
      )}

      <div className="mv-popover__section">
        {kind === 'model' ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={MODEL_VERSION.UPLOAD_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) {
                  onUploadNewVersion(file);
                  onClose();
                }
              }}
            />
            <button
              type="button"
              role="menuitem"
              className="mv-row"
              disabled={isUploadingVersion}
              onClick={() => fileInputRef.current?.click()}
            >
              <MenuIcon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              <span className="min-w-0 flex-1">
                <span className="block">{isUploadingVersion ? 'Uploading new version…' : 'Upload new version…'}</span>
                <span className="mv-hint block">.3dm, .obj, .ifc · adds v{(versions[0]?.number ?? 0) + 1} to this model</span>
              </span>
            </button>
            {sendScenesRow}
            <button type="button" role="menuitem" className="mv-row" onClick={() => { onOpenModelBrowser(); onClose(); }}>
              <MenuIcon d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
              <span className="min-w-0 flex-1">
                <span className="block">Open another model…</span>
                <span className="mv-hint block">Browse models in this project</span>
              </span>
            </button>
            {speckleUrl && (
              <a role="menuitem" className="mv-row" href={speckleUrl} target="_blank" rel="noopener noreferrer" onClick={onClose}>
                <MenuIcon d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
                <span>Open in Speckle</span>
              </a>
            )}
          </>
        ) : (
          <>
          <button type="button" role="menuitem" className="mv-row" onClick={() => { onOpenModelBrowser(); onClose(); }}>
            <MenuIcon d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            <span className="min-w-0 flex-1">
              <span className="block">Attach a model…</span>
              <span className="mv-hint block">Choose a Speckle model or upload a file</span>
            </span>
          </button>
          {sendScenesRow}
          </>
        )}
      </div>
    </div>
  );
}

function MenuIcon({ d }: { d: string }) {
  return (
    <svg width={ROW_ICON} height={ROW_ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d={d} />
    </svg>
  );
}
