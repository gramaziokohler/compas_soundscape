'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUIStore, useModelVersionStore, findModelVersion } from '@/store';
import { useSpeckleEngineStore } from '@/store/speckleEngineStore';
import { formatRelativeTime } from '@/components/scene/modelBrowserShared';
import { Spinner } from '@/components/ui/Spinner';
import { MODEL_VERSION, SANDBOX_MODEL_ID, SCENE_BOTTOM_BAR } from '@/utils/constants';
import { ModelVersionMenu } from './ModelVersionMenu';
import { useModelPillInfo } from './useModelPillInfo';

const ICON = SCENE_BOTTOM_BAR.ICON_SIZE;

export interface ModelPillProps {
  /** Open the model browser (Speckle models + file upload). */
  onOpenModelBrowser: () => void;
  /** Upload a file as a new version of the open model. */
  onUploadNewVersion: (file: File) => void;
  /** Open the "Send scenes to another model" dialog. */
  onSendScenes: () => void;
}

/** Box (model) or note (no-model soundscape) glyph. */
function PillIcon({ kind }: { kind: 'model' | 'project' }) {
  return kind === 'model' ? (
    <svg className="mv-pill__icon" width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  ) : (
    <svg className="mv-pill__icon" width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

/**
 * ModelPill
 *
 * Bottom-bar chip naming the open model (its file name, truncated) or the open
 * no-model soundscape. Hover shows the full details; click opens the model
 * menu (versions, upload a new version, open another model). Renders nothing
 * on the bare Home stage, where the bar keeps its "Load model" button.
 *
 * Usage:
 * ```tsx
 * <ModelPill onOpenModelBrowser={openBrowser} onUploadNewVersion={uploadVersion} onSendScenes={openSend} />
 * ```
 */
export function ModelPill({ onOpenModelBrowser, onUploadNewVersion, onSendScenes }: ModelPillProps) {
  const globalSpeckleData = useUIStore((s) => s.globalSpeckleData);
  const homeProject = useUIStore((s) => s.homeProject);
  const versions = useModelVersionStore((s) => s.versions);
  const loadedVersionId = useSpeckleEngineStore((s) => s.loadedModelVersionId);
  const isUploadingVersion = useModelVersionStore((s) => s.isUploadingVersion);
  const info = useModelPillInfo();

  const pillRef = useRef<HTMLButtonElement>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menuAnchorRight, setMenuAnchorRight] = useState<number | null>(null);
  const [hoverAnchorRight, setHoverAnchorRight] = useState<number | null>(null);

  const kind: 'model' | 'project' | null =
    globalSpeckleData?.model_id && globalSpeckleData.model_id !== SANDBOX_MODEL_ID
      ? 'model'
      : homeProject ? 'project' : null;

  const anchorRight = () => {
    const rect = pillRef.current?.getBoundingClientRect();
    return rect ? Math.max(SCENE_BOTTOM_BAR.PADDING_X, window.innerWidth - rect.right) : SCENE_BOTTOM_BAR.PADDING_X;
  };

  const clearHover = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setHoverAnchorRight(null);
  }, []);

  useEffect(() => clearHover, [clearHover]);

  const toggleMenu = () => {
    clearHover();
    setMenuAnchorRight((open) => (open === null ? anchorRight() : null));
  };

  if (!kind) return null;

  const loaded = findModelVersion(versions, loadedVersionId);
  const latest = versions[0] ?? null;
  const isOlder = !!loaded && !!latest && loaded.id !== latest.id;
  const name = kind === 'model' ? info.fileName : homeProject?.name ?? 'Untitled soundscape';

  return (
    <>
      <button
        ref={pillRef}
        type="button"
        className="mv-pill"
        data-open={menuAnchorRight !== null}
        style={{ maxWidth: MODEL_VERSION.PILL_MAX_WIDTH_PX }}
        aria-haspopup="menu"
        aria-expanded={menuAnchorRight !== null}
        aria-label={`${name} — model menu`}
        onClick={toggleMenu}
        onMouseEnter={() => {
          if (menuAnchorRight !== null) return;
          hoverTimerRef.current = setTimeout(() => setHoverAnchorRight(anchorRight()), MODEL_VERSION.HOVER_CARD_DELAY_MS);
        }}
        onMouseLeave={clearHover}
      >
        {isUploadingVersion ? <Spinner size={ICON} className="flex-shrink-0" /> : <PillIcon kind={kind} />}
        <span className="mv-pill__name">{name}</span>
        {kind === 'model' && loaded && (
          <span className={isOlder ? 'mv-tag mv-tag--warning' : 'mv-tag'}>
            v{loaded.number}{isOlder ? ' · older' : ''}
          </span>
        )}
        {kind === 'project' && <span className="mv-tag mv-tag--neutral">no model</span>}
        {kind === 'model' && isOlder && !info.isPinned && <span className="mv-dot" aria-label="Newer version published" />}
        <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>

      {hoverAnchorRight !== null && (
        <div
          className="bar-popover mv-popover"
          role="tooltip"
          style={{ right: hoverAnchorRight, width: MODEL_VERSION.HOVER_CARD_WIDTH_PX, padding: '9px 11px', pointerEvents: 'none' }}
        >
          <p className="font-medium" style={{ wordBreak: 'break-all' }}>{name}</p>
          {kind === 'model' ? (
            <>
              {info.modelName && info.modelName !== name && (
                <p className="mv-muted mt-1">Speckle model: {info.modelName}</p>
              )}
              {loaded && (
                <p className="mv-muted mt-0.5">
                  Version {loaded.number} of {versions.length}
                  {loaded.is_latest ? ' · latest' : ' · older'}
                  {loaded.source_application ? ` · ${loaded.source_application}` : ''}
                </p>
              )}
              {loaded && (loaded.author_name || loaded.created_at) && (
                <p className="mv-muted mt-0.5">
                  {[loaded.author_name && `Pushed by ${loaded.author_name}`, loaded.created_at && formatRelativeTime(loaded.created_at)]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              <p className="mv-hint mt-1.5">Click to change version, upload, or open another model</p>
            </>
          ) : (
            <>
              <p className="mv-muted mt-1">Soundscape without a model</p>
              <p className="mv-hint mt-1.5">Click to attach a model</p>
            </>
          )}
        </div>
      )}

      {menuAnchorRight !== null && (
        <ModelVersionMenu
          kind={kind}
          anchorRight={menuAnchorRight}
          name={name}
          ignoreRef={pillRef}
          onClose={() => setMenuAnchorRight(null)}
          onOpenModelBrowser={onOpenModelBrowser}
          onUploadNewVersion={onUploadNewVersion}
          onSendScenes={onSendScenes}
        />
      )}
    </>
  );
}
