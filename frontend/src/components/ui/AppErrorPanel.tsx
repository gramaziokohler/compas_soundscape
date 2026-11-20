"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { reportSceneRenderError } from "@/lib/diagnostics/crash-reporter";
import { APP_ERROR } from "@/utils/constants";

export interface AppErrorPanelProps {
  error: Error;
  /** Re-render the failed route segment (Next.js error boundary reset). */
  reset: () => void;
}

/**
 * AppErrorPanel Component
 *
 * Full-page fallback for a render error outside the 3D scene (Next.js `error.tsx` /
 * `global-error.tsx`). Reports the error to the backend client-diagnostics log and
 * offers "Try again" (re-render) or a full page reload. Reuses the viewer recovery styles.
 *
 * Usage:
 * ```tsx
 * export default function Error({ error, reset }) { return <AppErrorPanel error={error} reset={reset} />; }
 * ```
 */
export function AppErrorPanel({ error, reset }: AppErrorPanelProps) {
  useEffect(() => {
    reportSceneRenderError(error, { componentStack: null });
  }, [error]);

  return (
    <div className="viewer-recovery viewer-recovery--page" role="alert">
      <div className="viewer-recovery__card">
        <div className="viewer-recovery__title">{APP_ERROR.TITLE}</div>
        <p className="viewer-recovery__message">{APP_ERROR.MESSAGE}</p>
        <div className="flex gap-2">
          <button type="button" className="viewer-recovery__button" onClick={reset}>
            {APP_ERROR.RETRY_LABEL}
          </button>
          <button type="button" className="viewer-recovery__button" onClick={() => window.location.reload()}>
            <RefreshCw size={14} aria-hidden="true" />
            {APP_ERROR.RELOAD_LABEL}
          </button>
        </div>
      </div>
    </div>
  );
}
