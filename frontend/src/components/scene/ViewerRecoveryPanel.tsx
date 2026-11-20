'use client';

import { RefreshCw } from 'lucide-react';
import { VIEWER_RECOVERY } from '@/utils/constants';

export interface ViewerRecoveryPanelProps {
  title: string;
  message: string;
  onReload: () => void;
}

/**
 * Centered panel over the 3D area offering to re-create the viewer after it
 * stopped (WebGL context lost, render error). The rest of the app — sidebars,
 * timeline, sound — keeps running behind it.
 */
export function ViewerRecoveryPanel({ title, message, onReload }: ViewerRecoveryPanelProps) {
  return (
    <div className="viewer-recovery" role="alert">
      <div className="viewer-recovery__card">
        <div className="viewer-recovery__title">{title}</div>
        <p className="viewer-recovery__message">{message}</p>
        <button type="button" className="viewer-recovery__button" onClick={onReload}>
          <RefreshCw size={14} aria-hidden="true" />
          {VIEWER_RECOVERY.RELOAD_LABEL}
        </button>
      </div>
    </div>
  );
}
